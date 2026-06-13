#!/bin/bash

# Test Data Management API Endpoints

echo "=== Testing Data Management API ==="
echo ""

API_BASE="http://localhost:3000/api"

# Test 1: Get Dashboard Summary
echo "1. Testing GET /data-management/dashboard/summary"
curl -s -X GET "$API_BASE/data-management/dashboard/summary" \
  -H "Authorization: Bearer test-token" \
  -H "Content-Type: application/json" | jq '.' || echo "Failed or invalid response"
echo ""
echo "---"
echo ""

# Test 2: Get Recent Tasks
echo "2. Testing GET /data-management/dashboard/recent-tasks"
curl -s -X GET "$API_BASE/data-management/dashboard/recent-tasks" \
  -H "Authorization: Bearer test-token" \
  -H "Content-Type: application/json" | jq '.' || echo "Failed or invalid response"
echo ""
echo "---"
echo ""

echo "=== API Tests Complete ==="
