const db = require("../config/db");
const fs = require("fs");

const { S3Client, GetObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
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

  const params = {
    Bucket: BUCKET_NAME,
    Key: key,
    Body: fileStream
  };

  s3Client.send(new (require("@aws-sdk/client-s3").PutObjectCommand)(params))
    .then(() => {

      const query = `
        INSERT INTO files (user_id, file_name, s3_key, file_size)
        VALUES (?, ?, ?, ?)
      `;

      db.query(query, [
        1, // replace with JWT user id later
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
  db.query("SELECT * FROM files", (err, results) => {
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
    const fileName = req.query.fileName;

    if (!fileName) {
      return res.status(400).json({ message: "fileName required" });
    }

    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: fileName
    });

    const url = await getSignedUrl(s3Client, command, {
      expiresIn: 60
    });

    res.json({ url });

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
    db.query("SELECT s3_key FROM files WHERE id = ?", [id], async (err, results) => {
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
      db.query("DELETE FROM files WHERE id = ?", [id], (err2) => {
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
