#!/bin/bash

# Start Crawlyx - tries Docker first, falls back to Python

echo "Checking for Docker..."
if command -v docker &> /dev/null && command -v docker compose &> /dev/null; then
    echo "Docker found! Starting Crawlyx with Docker..."
    docker compose up -d

    # Wait for the service to be ready
    echo "Waiting for Crawlyx to start..."
    sleep 3

    # Check if container is running
    if docker ps | grep -q crawlyx; then
        echo ""
        echo "================================================================================"
        echo "Crawlyx is running!"
        echo "Opening browser to http://localhost:5000"
        echo ""
        echo "Press Ctrl+C to stop Crawlyx and exit"
        echo "DO NOT close this terminal or Crawlyx will keep running in the background!"
        echo "================================================================================"
        echo ""

        # Detect OS and open browser
        if [[ "$OSTYPE" == "linux-gnu"* ]]; then
            xdg-open http://localhost:5000 2>/dev/null || sensible-browser http://localhost:5000
        elif [[ "$OSTYPE" == "darwin"* ]]; then
            open http://localhost:5000
        else
            echo "Please open http://localhost:5000 in your browser"
        fi

        # Trap Ctrl+C to gracefully shutdown
        trap 'echo ""; echo "Stopping Crawlyx..."; docker compose down; exit 0' INT

        # Keep terminal open and show logs
        echo "Showing live logs (press Ctrl+C to stop):"
        echo ""
        docker compose logs -f
    else
        echo "Error: Crawlyx container failed to start"
        docker compose logs
        exit 1
    fi
else
    echo "Docker not found. Checking for Python..."

    # Check for Python 3
    if ! command -v python3 &> /dev/null; then
        echo "Python 3 not found! Please install Python 3.11 or later."
        echo ""
        echo "Installation instructions:"
        echo "  Ubuntu/Debian: sudo apt install python3 python3-pip"
        echo "  macOS: brew install python@3.11"
        echo "  Or download from: https://www.python.org/downloads/"
        exit 1
    fi

    echo "Python found! Installing dependencies..."

    # Check if pip is available
    if ! command -v pip3 &> /dev/null; then
        echo "pip not found! Installing pip..."
        python3 -m ensurepip --default-pip
    fi

    # Check if Flask is installed
    if ! python3 -c "import flask" &> /dev/null; then
        echo "Installing Python packages from requirements.txt..."
        pip3 install -r requirements.txt

        if [ $? -ne 0 ]; then
            echo "Failed to install dependencies!"
            exit 1
        fi

        echo "Installing Playwright browsers..."
        playwright install chromium
    fi

    echo "Starting Crawlyx..."
    echo "Opening browser to http://localhost:5000"

    # Open browser after 2 seconds (give Flask time to start)
    (sleep 2 && {
        if [[ "$OSTYPE" == "linux-gnu"* ]]; then
            xdg-open http://localhost:5000 2>/dev/null || sensible-browser http://localhost:5000
        elif [[ "$OSTYPE" == "darwin"* ]]; then
            open http://localhost:5000
        fi
    }) &

    # Run main.py
    python3 main.py
fi
