const db = require("../config/db");

const dbQuery = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.query(sql, params, (err, result) => {
      if (err) return reject(err);
      resolve(result);
    });
  });

exports.loadFile = async (req, res, next, id) => {
  try {
    const rows = await dbQuery("SELECT * FROM files WHERE id = ?", [id]);
    if (rows.length === 0) {
      return res.status(404).json({ message: "File not found" });
    }
    req.fileRecord = rows[0];
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "DB error" });
  }
};

exports.requireOwner = (req, res, next) => {
  const file = req.fileRecord;
  if (!file) {
    return res.status(404).json({ message: "File not found" });
  }
  if (file.user_id !== req.user.id) {
    return res.status(403).json({ message: "Only the file owner can perform this action" });
  }
  next();
};

exports.requireFileAccess = async (req, res, next) => {
  const file = req.fileRecord;
  if (!file) {
    return res.status(404).json({ message: "File not found" });
  }
  if (file.user_id === req.user.id) {
    return next();
  }
  if (file.visibility === "public") {
    return next();
  }
  if (file.visibility === "shared") {
    try {
      const rows = await dbQuery(
        "SELECT 1 FROM file_shares WHERE file_id = ? AND shared_with_user_id = ? LIMIT 1",
        [file.id, req.user.id]
      );
      if (rows.length > 0) {
        return next();
      }
      return res.status(403).json({ message: "Unauthorized" });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ message: "DB error" });
    }
  }
  return res.status(403).json({ message: "Unauthorized" });
};
