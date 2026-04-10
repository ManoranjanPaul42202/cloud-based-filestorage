const db = require("../config/db");
const fs = require("fs");
const AWS = require("aws-sdk");
const { contentTypeForFileName, resolveUploadContentType } = require("../utils/contentType");
const {
  S3Client,
  GetObjectCommand,
  DeleteObjectCommand,
  PutObjectCommand
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

const BUCKET_NAME = process.env.AWS_BUCKET_NAME;
const CLOUDFRONT_URL = (process.env.CLOUDFRONT_URL || "").replace(/\/+$/, "");
const CLOUDFRONT_KEY_PAIR_ID = process.env.CLOUDFRONT_KEY_PAIR_ID;
const CLOUDFRONT_PRIVATE_KEY = process.env.CLOUDFRONT_PRIVATE_KEY;

const VALID_VISIBILITIES = ["private", "shared", "public"];
const VALID_PERMISSIONS = ["view", "download"];

const dbQuery = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.query(sql, params, (err, result) => {
      if (err) return reject(err);
      resolve(result);
    });
  });

const normalizeKey = (key) =>
  key
    .split("/")
    .map(encodeURIComponent)
    .join("/");

const getCloudFrontUrl = (key) => `${CLOUDFRONT_URL}/${normalizeKey(key)}`;

const getCloudFrontSignedUrl = (url, expiresInSeconds) => {
  if (!CLOUDFRONT_KEY_PAIR_ID || !CLOUDFRONT_PRIVATE_KEY) {
    throw new Error("CloudFront signing configuration missing");
  }

  const signer = new AWS.CloudFront.Signer(CLOUDFRONT_KEY_PAIR_ID, CLOUDFRONT_PRIVATE_KEY);
  return signer.getSignedUrl({
    url,
    expires: Math.floor(Date.now() / 1000) + expiresInSeconds
  });
};

const getS3SignedUrl = async (key, expiresInSeconds) => {
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key
  });
  return getSignedUrl(s3Client, command, { expiresIn: expiresInSeconds });
};

const resolveUserIdByEmail = async (email) => {
  const rows = await dbQuery("SELECT id FROM users WHERE LOWER(email) = LOWER(?)", [email]);
  if (rows.length === 0) return null;
  return rows[0].id;
};

const canAccessFile = async (userId, file) => {
  if (!file) return false;
  if (file.user_id === userId) return true;
  if (file.visibility === "public") return true;
  if (file.visibility === "shared") {
    const rows = await dbQuery(
      "SELECT 1 FROM file_shares WHERE file_id = ? AND shared_with_user_id = ? LIMIT 1",
      [file.id, userId]
    );
    return rows.length > 0;
  }
  return false;
};

exports.uploadFile = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "No file uploaded" });
  }

  const visibility = (req.body.visibility || "private").toLowerCase();
  if (!VALID_VISIBILITIES.includes(visibility)) {
    return res.status(400).json({ message: `visibility must be one of ${VALID_VISIBILITIES.join(", ")}` });
  }

  const file = req.file;
  const fileStream = fs.createReadStream(file.path);
  const key = `${Date.now()}_${file.originalname}`;

  const contentType = resolveUploadContentType(file.originalname, file.mimetype);
  const params = {
    Bucket: BUCKET_NAME,
    Key: key,
    Body: fileStream,
    ContentType: contentType
  };

  try {
    await s3Client.send(new PutObjectCommand(params));

    const query = `
      INSERT INTO files (file_name, s3_key, file_size, user_id, visibility, upload_date)
      VALUES (?, ?, ?, ?, ?, NOW())
    `;

    await dbQuery(query, [file.originalname, key, file.size, req.user.id, visibility]);
    fs.unlink(file.path, () => {});

    res.json({
      message: "File uploaded successfully",
      key,
      visibility
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Upload failed" });
  }
};

exports.getFiles = async (req, res) => {
  try {
    const rows = await dbQuery(
      `SELECT f.*, COUNT(fs.id) AS shared_count
       FROM files f
       LEFT JOIN file_shares fs ON fs.file_id = f.id
       WHERE f.user_id = ?
       GROUP BY f.id
       ORDER BY f.upload_date DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "DB error" });
  }
};

exports.getSharedFiles = async (req, res) => {
  try {
    const rows = await dbQuery(
      `SELECT f.id, f.file_name, f.s3_key, f.file_size, f.user_id, f.visibility, f.upload_date, fs.permission,
              u.email AS owner_email
       FROM file_shares fs
       JOIN files f ON f.id = fs.file_id
       JOIN users u ON u.id = f.user_id
       WHERE fs.shared_with_user_id = ?
         AND f.visibility = 'shared'
       ORDER BY f.upload_date DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "DB error" });
  }
};

exports.getFileById = async (req, res) => {
  const file = req.fileRecord;
  if (!file) {
    return res.status(404).json({ message: "File not found" });
  }
  res.json(file);
};

exports.getDownloadUrl = async (req, res) => {
  try {
    const fileId = req.query.fileId;
    if (!fileId) {
      return res.status(400).json({ message: "fileId required" });
    }

    const rows = await dbQuery("SELECT * FROM files WHERE id = ?", [fileId]);
    if (rows.length === 0) {
      return res.status(404).json({ message: "File not found" });
    }
    const file = rows[0];
    const allowed = await canAccessFile(req.user.id, file);
    if (!allowed) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const expiresInSeconds = 300;
    const encodedKey = normalizeKey(file.s3_key);
    const s3PublicUrl = `https://${BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${encodedKey}`;

    if (CLOUDFRONT_URL && CLOUDFRONT_KEY_PAIR_ID && CLOUDFRONT_PRIVATE_KEY) {
      try {
        const cloudFrontUrl = getCloudFrontUrl(file.s3_key);
        const signedUrl = getCloudFrontSignedUrl(cloudFrontUrl, expiresInSeconds);
        return res.json({ url: signedUrl, expiresInSeconds });
      } catch (cloudfrontError) {
        console.warn("CloudFront signing failed, falling back to S3:", cloudfrontError.message);
      }
    }

    if (file.visibility === "public" && !CLOUDFRONT_URL) {
      return res.json({ url: s3PublicUrl, expiresInSeconds });
    }

    const signedS3Url = await getS3SignedUrl(file.s3_key, expiresInSeconds);
    res.json({ url: signedS3Url, expiresInSeconds });
  } catch (err) {
    console.error("Download Error:", err);
    res.status(500).json({ message: err.message });
  }
};

exports.shareFile = async (req, res) => {
  const file = req.fileRecord;
  if (!file) {
    return res.status(404).json({ message: "File not found" });
  }

  const { shared_with_user_id, shared_with_email, permission = "view" } = req.body;
  const email = typeof shared_with_email === "string" ? shared_with_email.trim() : "";
  let targetUserId = typeof shared_with_user_id === "number"
    ? shared_with_user_id
    : Number(shared_with_user_id || NaN);

  if (!Number.isInteger(targetUserId) && email) {
    targetUserId = await resolveUserIdByEmail(email);
    if (!targetUserId) {
      return res.status(404).json({ message: "Target user not found for provided email." });
    }
  }

  if (!Number.isInteger(targetUserId)) {
    return res.status(400).json({ message: "shared_with_email or shared_with_user_id is required" });
  }
  if (!VALID_PERMISSIONS.includes(permission)) {
    return res.status(400).json({ message: `permission must be one of ${VALID_PERMISSIONS.join(", ")}` });
  }
  if (targetUserId === req.user.id) {
    return res.status(400).json({ message: "Owner cannot be added as a shared user" });
  }

  try {
    const users = await dbQuery("SELECT id FROM users WHERE id = ?", [targetUserId]);
    if (users.length === 0) {
      return res.status(404).json({ message: "Target user not found" });
    }

    const existingShare = await dbQuery('SELECT * FROM file_shares WHERE file_id = ? AND shared_with_user_id = ?', [file.id, targetUserId]);
    if (existingShare.length > 0) {
      return res.status(400).json({ message: 'File already shared with this user' });
    }

    await dbQuery(
      `INSERT INTO file_shares (file_id, shared_with_user_id, permission, created_at)
       VALUES (?, ?, ?, NOW())`,
      [file.id, targetUserId, permission]
    );

    if (file.visibility === "private") {
      await dbQuery("UPDATE files SET visibility = 'shared' WHERE id = ?", [file.id]);
    }

    res.json({ message: "File shared successfully", fileId: file.id, shared_with_user_id: targetUserId, shared_with_email: email || null, permission });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Could not share file" });
  }
};

exports.changeVisibility = async (req, res) => {
  const file = req.fileRecord;
  if (!file) {
    return res.status(404).json({ message: "File not found" });
  }

  const visibility = (req.body.visibility || "").toLowerCase();
  if (!VALID_VISIBILITIES.includes(visibility)) {
    return res.status(400).json({ message: `visibility must be one of ${VALID_VISIBILITIES.join(", ")}` });
  }

  try {
    await dbQuery("UPDATE files SET visibility = ? WHERE id = ?", [visibility, file.id]);
    res.json({ message: "Visibility updated", fileId: file.id, visibility });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Could not update visibility" });
  }
};

exports.revokeShare = async (req, res) => {
  const file = req.fileRecord;
  if (!file) {
    return res.status(404).json({ message: "File not found" });
  }

  const email = req.body.shared_with_email || req.query.shared_with_email;
  const userIdParam = req.body.shared_with_user_id || req.query.shared_with_user_id;
  let targetUserId = typeof userIdParam === "number"
    ? userIdParam
    : Number(userIdParam || NaN);

  if (!Number.isInteger(targetUserId) && email) {
    targetUserId = await resolveUserIdByEmail(email);
    if (!targetUserId) {
      return res.status(404).json({ message: "Target user not found for provided email." });
    }
  }

  if (!Number.isInteger(targetUserId)) {
    return res.status(400).json({ message: "shared_with_email or shared_with_user_id is required" });
  }

  try {
    const result = await dbQuery(
      "DELETE FROM file_shares WHERE file_id = ? AND shared_with_user_id = ?",
      [file.id, targetUserId]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Share entry not found" });
    }
    res.json({ message: "Share revoked", fileId: file.id, shared_with_user_id: targetUserId, shared_with_email: email || null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Could not revoke share" });
  }
};

exports.deleteFile = async (req, res) => {
  const file = req.fileRecord;
  if (!file) {
    return res.status(404).json({ message: "File not found" });
  }

  try {
    await s3Client.send(new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: file.s3_key }));
    await dbQuery("DELETE FROM files WHERE id = ?", [file.id]);
    await dbQuery("DELETE FROM file_shares WHERE file_id = ?", [file.id]);
    res.json({ message: "File deleted successfully", fileId: file.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Could not delete file" });
  }
};

exports.renameFile = async (req, res) => {
  const file = req.fileRecord;
  if (!file) {
    return res.status(404).json({ message: "File not found" });
  }

  const fileName = (req.body.file_name || "").trim();
  if (!fileName) {
    return res.status(400).json({ message: "file_name is required" });
  }

  try {
    await dbQuery("UPDATE files SET file_name = ? WHERE id = ?", [fileName, file.id]);
    res.json({ message: "File renamed successfully", fileId: file.id, file_name: fileName });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Could not rename file" });
  }
};
