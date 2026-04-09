const express = require('express');
const multer = require('multer');
const s3 = require('../config/s3');

const router = express.Router();

const upload = multer({ storage: multer.memoryStorage() });

router.post('/', upload.single('file'), async (req, res) => {
  try {
    const params = {
      Bucket: 'cc-project-storage-12345', // 🔥 replace this
      Key: Date.now() + '-' + req.file.originalname,
      Body: req.file.buffer
    };

    const data = await s3.upload(params).promise();

    res.json({
      message: 'File uploaded successfully',
      url: data.Location
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
