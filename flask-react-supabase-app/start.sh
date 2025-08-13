#!/bin/bash

# Function to check if a command exists
command_exists() {
  command -v "$1" >/dev/null 2>&1
}

# Set terminal colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

printf "${BLUE}=========================================${NC}\n"
printf "${GREEN}Car Classifieds Application Starter${NC}\n"
printf "${BLUE}=========================================${NC}\n\n"

# Ensure we're in the correct directory
cd "$(dirname "$0")"

# Check for necessary tools
if ! command_exists node; then
  printf "${RED}Node.js is not installed. Please install Node.js to run the frontend.${NC}\n"
  exit 1
fi

if ! command_exists python3; then
  printf "${RED}Python 3 is not installed. Please install Python 3 to run the backend.${NC}\n"
  exit 1
fi

# Check for .env file in backend directory
if [ ! -f "backend/.env" ]; then
  printf "${YELLOW}Warning: No .env file found in backend directory. Creating a sample one...${NC}\n"
  echo "SUPABASE_URL=https://your-supabase-url.supabase.co" > backend/.env
  echo "SUPABASE_KEY=your-supabase-key" >> backend/.env
  printf "${YELLOW}Please update backend/.env with your actual Supabase credentials.${NC}\n\n"
else
  printf "${GREEN}Found .env file in backend directory.${NC}\n"
fi

# Start the backend
printf "${BLUE}Starting the Flask backend...${NC}\n"
cd backend

# Check for virtual environment and create if doesn't exist
if [ ! -d "venv" ]; then
  printf "${YELLOW}Creating a virtual environment...${NC}\n"
  python3 -m venv venv
  printf "${GREEN}Virtual environment created.${NC}\n"
fi

# Activate virtual environment
printf "${BLUE}Activating virtual environment...${NC}\n"
source venv/bin/activate

# Install dependencies
printf "${BLUE}Installing backend dependencies...${NC}\n"
pip install -r requirements.txt

# Start the Flask server in the background
printf "${GREEN}Starting Flask server...${NC}\n"
cd ..
python3 -m backend.app &

# Store the backend PID
BACKEND_PID=$!
printf "${GREEN}Backend running with PID: ${BACKEND_PID}${NC}\n\n"

# Start the frontend
printf "${BLUE}Starting the React frontend...${NC}\n"
cd frontend

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
  printf "${YELLOW}Installing frontend dependencies...${NC}\n"
  npm install
  printf "${GREEN}Frontend dependencies installed.${NC}\n"
fi

# Start the React development server
printf "${GREEN}Starting React development server...${NC}\n"
npm start &

# Store the frontend PID
FRONTEND_PID=$!
printf "${GREEN}Frontend running with PID: ${FRONTEND_PID}${NC}\n\n"

printf "${BLUE}=========================================${NC}\n"
printf "${GREEN}Application is now running!${NC}\n"
printf "${YELLOW}Backend:${NC} http://localhost:8000\n"
printf "${YELLOW}Frontend:${NC} http://localhost:3000\n"
printf "${BLUE}=========================================${NC}\n\n"

# Function to handle script termination
cleanup() {
  printf "\n${YELLOW}Shutting down services...${NC}\n"
  kill $BACKEND_PID 2>/dev/null
  kill $FRONTEND_PID 2>/dev/null
  printf "${GREEN}Services stopped.${NC}\n"
  exit 0
}

# Trap Ctrl+C and call cleanup
trap cleanup INT

# Wait for user to press Ctrl+C
printf "${YELLOW}Press Ctrl+C to stop all services${NC}\n"
wait 