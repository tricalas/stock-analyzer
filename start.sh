#!/bin/bash

echo "Starting Stock Analyzer..."
echo ""

# Backend 시작
echo "Starting backend server..."
cd backend
python3 -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!
echo "Backend started with PID: $BACKEND_PID"
echo "Backend running at: http://localhost:8000"
echo "API Docs available at: http://localhost:8000/docs"
echo ""

# Frontend 시작
echo "Starting frontend server..."
cd ../frontend
npm run dev &
FRONTEND_PID=$!
echo "Frontend started with PID: $FRONTEND_PID"
echo "Frontend running at: http://localhost:3000"
echo ""

echo "================================"
echo "Stock Analyzer is running!"
echo "Frontend: http://localhost:3000"
echo "Backend API: http://localhost:8000"
echo "API Docs: http://localhost:8000/docs"
echo "================================"
echo ""
echo "Press Ctrl+C to stop all servers"

# Wait for interrupt
trap "echo 'Stopping servers...'; kill $BACKEND_PID $FRONTEND_PID; exit" INT
wait