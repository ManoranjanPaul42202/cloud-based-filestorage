const express = require('express');
const s3 = require('../config/s3');

const router = express.Router();

router.get('/', async (req, res) => {
  console.log("FILE ROUTE HIT"); // ✅ DEBUG

  try {
    const key = req.query.key;
    console.log("KEY:", key); // ✅ DEBUG

    if (!key) {
      return res.status(400).json({ error: 'File key is required' });
    }

    const params = {
      Bucket: 'cc-project-storage-12345',
      Key: key,
      Expires: 300
    };

    const url = await s3.getSignedUrlPromise('getObject', params);

    res.json({
      message: 'Signed URL generated',
      url: url
    });

  } catch (error) {
    console.error("ERROR:", error);
    res.status(500).json({ error: 'Error generating signed URL' });
  }
});

module.exports = router;
