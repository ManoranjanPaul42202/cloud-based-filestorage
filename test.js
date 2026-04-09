const axios = require("axios");

// 🔴 CHANGE THIS BASE URL
const BASE_URL = "http://13.60.86.187:3000/";

async function testSignup() {
  try {
    const res = await axios.post(`${BASE_URL}/signup`, {
      name: "Test User",
      email: "test@example.com",
      password: "123456"
    });

    console.log("✅ Signup:", res.data);
  } catch (err) {
    console.log("❌ Signup Error:", err.response?.data || err.message);
  }
}

async function testLogin() {
  try {
    const res = await axios.post(`${BASE_URL}/login`, {
      email: "test@example.com",
      password: "123456"
    });

    console.log("✅ Login:", res.data);
  } catch (err) {
    console.log("❌ Login Error:", err.response?.data || err.message);
  }
}

async function testUpload() {
  try {
    const res = await axios.post(`${BASE_URL}/upload`, {
      fileName: "test.txt",
      content: "Hello from test.js"
    });

    console.log("✅ Upload:", res.data);
  } catch (err) {
    console.log("❌ Upload Error:", err.response?.data || err.message);
  }
}

async function testGetFiles() {
  try {
    const res = await axios.get(`${BASE_URL}/files`);
    console.log("✅ Files:", res.data);
  } catch (err) {
    console.log("❌ Get Files Error:", err.response?.data || err.message);
  }
}

async function runTests() {
  console.log("🚀 Starting API Tests...\n");

  await testSignup();
  await testLogin();
  await testUpload();
  await testGetFiles();

  console.log("\n🎯 All tests completed!");
}

runTests();
