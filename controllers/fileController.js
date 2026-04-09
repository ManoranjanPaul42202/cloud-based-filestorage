const db = require("../config/db");
const fs = require("fs");
const { contentTypeForFileName, resolveUploadContentType } = require("../utils/contentType");

const {
  S3Client,
  GetObjectCommand,
  DeleteObjectCommand,
  PutObjectCommand
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

// 🔥 S3 CLIENT
const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

const BUCKET_NAME = process.env.AWS_BUCKET_NAME;

/* ===================== UPLOAD FILE ===================== */
exports.uploadFile = (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "No file uploaded" });
  }

  const file = req.file;
  const fileStream = fs.createReadStream(file.path);

  const key = Date.now() + "_" + file.originalname;

  const contentType = resolveUploadContentType(file.originalname, file.mimetype);
  const params = {
    Bucket: BUCKET_NAME,
    Key: key,
    Body: fileStream,
    ContentType: contentType
  };

  s3Client.send(new PutObjectCommand(params))
    .then(() => {

      const query = `
        INSERT INTO files (user_id, file_name, s3_key, file_size)
        VALUES (?, ?, ?, ?)
      `;

      db.query(query, [
        req.user.id,
        file.originalname,
        key,
        file.size
      ], (err) => {
        if (err) {
          console.error(err);
          return res.status(500).json({ message: "DB insert failed" });
        }

        // Delete temp file
        fs.unlink(file.path, () => {});

        res.json({
          message: "File uploaded successfully",
          key: key
        });
      });

    })
    .catch(err => {
      console.error(err);
      res.status(500).json({ message: "Upload failed" });
    });
};


/* ===================== GET FILES ===================== */
exports.getFiles = (req, res) => {
  db.query("SELECT * FROM files WHERE user_id = ?", [req.user.id], (err, results) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ message: "DB error" });
    }

    res.json(results);
  });
};


/* ===================== GET DOWNLOAD URL ===================== */
exports.getDownloadUrl = async (req, res) => {
  try {
    const fileId = req.query.fileId;

    if (!fileId) {
      return res.status(400).json({ message: "fileId required" });
    }

    db.query(
      "SELECT s3_key, file_name FROM files WHERE id = ? AND user_id = ?",
      [fileId, req.user.id],
      async (dbErr, result) => {
        if (dbErr) return res.status(500).json({ message: "DB error" });
        if (result.length === 0) return res.status(404).json({ message: "File not found" });

        const row = result[0];
        const fileName = row.file_name || "download";
        const ct = contentTypeForFileName(fileName);
        const command = new GetObjectCommand({
          Bucket: BUCKET_NAME,
          Key: row.s3_key,
          ResponseContentType: ct,
          ResponseContentDisposition: `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`
        });

        const expiresInSeconds = 300;
        const url = await getSignedUrl(s3Client, command, {
          expiresIn: expiresInSeconds
        });

        res.json({ url, expiresInSeconds });
      }
    );

  } catch (err) {
    console.error("Download Error:", err);
    res.status(500).json({ message: err.message });
  }
};


/* ===================== DELETE FILE ===================== */
exports.deleteFile = async (req, res) => {
  try {
    const { id } = req.params;

    // Step 1: Get file key from DB
    db.query(
      "SELECT s3_key FROM files WHERE id = ? AND user_id = ?",
      [id, req.user.id],
      async (err, results) => {
      if (err) {
        return res.status(500).json({ message: "DB error" });
      }

      if (results.length === 0) {
        return res.status(404).json({ message: "File not found" });
      }

      const fileKey = results[0].s3_key;

      // Step 2: Delete from S3
      const deleteCommand = new DeleteObjectCommand({
        Bucket: BUCKET_NAME,
        Key: fileKey
      });

      await s3Client.send(deleteCommand);

      // Step 3: Delete from DB
      db.query("DELETE FROM files WHERE id = ? AND user_id = ?", [id, req.user.id], (err2) => {
        if (err2) {
          return res.status(500).json({ message: "DB delete failed" });
        }

        res.json({ message: "File deleted successfully" });
      });
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
};

exports.getFileById = (req, res) => {
  const { id } = req.params;
  db.query(
    "SELECT * FROM files WHERE id = ? AND user_id = ?",
    [id, req.user.id],
    (err, result) => {
      if (err) return res.status(500).json({ message: "DB error" });
      if (result.length === 0) return res.status(404).json({ message: "File not found" });
      res.json(result[0]);
    }
  );
};

exports.renameFile = (req, res) => {
  const { id } = req.params;
  const { file_name } = req.body;

  if (!file_name || !file_name.trim()) {
    return res.status(400).json({ message: "file_name is required" });
  }

  db.query(
    "UPDATE files SET file_name = ? WHERE id = ? AND user_id = ?",
    [file_name.trim(), id, req.user.id],
    (err, result) => {
      if (err) return res.status(500).json({ message: "DB error" });
      if (result.affectedRows === 0) {
        return res.status(404).json({ message: "File not found" });
      }
      res.json({ message: "File renamed successfully" });
    }
  );
};
