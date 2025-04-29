# FinStruct - Excel AI Assistant MVP

This project is an MVP (Minimum Viable Product) for an Office.js Excel add-in that allows users to transform spreadsheet data using natural language prompts processed by a locally running Large Language Model (LLM).

Based on the technical spec in `spec.md`.

## Prerequisites

Before you begin, ensure you have the following installed:

*   **Node.js and npm:** Required for the Office Add-in frontend. Download from [nodejs.org](https://nodejs.org/).
*   **Python:** Version 3.9+ recommended for the backend server. Download from [python.org](https://python.org/).
*   **pip:** Python's package installer (usually comes with Python).
*   **C++ Compiler & CMake:** Required by `llama-cpp-python` to build the underlying llama.cpp library.
    *   **macOS:** Install Xcode Command Line Tools: `xcode-select --install`
    *   **Windows:** Install Visual Studio with C++ development workload (includes MSVC compiler and CMake).
    *   **Linux:** Install `build-essential` and `cmake` (e.g., `sudo apt update && sudo apt install build-essential cmake`).
*   **(Optional) GPU Support:** For significantly faster LLM inference:
    *   **NVIDIA:** Install CUDA Toolkit.
    *   **Apple Silicon (M1/M2/M3):** Metal support is often enabled by default with recent `llama-cpp-python` versions when installed on macOS.

## Setup

1.  **Clone the Repository:** (Assuming you've already done this)
    ```bash
    git clone <repository-url>
    cd finstruct
    ```

2.  **Backend Setup (Python Server):**
    *   **Navigate to server directory:**
        ```bash
        cd server
        ```
    *   **Download LLM Model:** Download the required GGUF model file (e.g., `codellama-7b-instruct.Q4_K_M.gguf` from Hugging Face) and place it inside the `server/models/` directory. Create the `models` directory if it doesn't exist (`mkdir models`).
        *   *Note: The expected filename is currently set in `server/model.py`.*
    *   **Create Virtual Environment (Recommended):**
        ```bash
        python -m venv venv
        source venv/bin/activate  # macOS/Linux
        # venv\Scripts\activate  # Windows
        ```
    *   **Install Python Dependencies:**
        ```bash
        pip install -r requirements.txt
        ```
        *   *Note:* This step compiles `llama.cpp`. If you have GPU support and want to enable it, you might need specific environment variables before running pip install (e.g., `CMAKE_ARGS="-DLLAMA_CUBLAS=on" pip install llama-cpp-python`). Refer to the [llama-cpp-python documentation](https://github.com/abetlen/llama-cpp-python) for details. The current `server/model.py` assumes Metal support (`N_GPU_LAYERS=1`); adjust if needed.
    *   **Navigate back to root:**
        ```bash
        cd ..
        ```

3.  **Frontend Setup (Office Add-in):**
    *   **Navigate to addin directory:**
        ```bash
        cd addin
        ```
    *   **Install Node.js Dependencies:**
        ```bash
        npm install
        ```
    *   **Install Office Add-in Dev Tools (if not already installed globally):**
        ```bash
        npm install -g office-addin-debugging
        ```
    *   **Navigate back to root:**
        ```bash
        cd ..
        ```

## Running the Application

You need to run both the backend server and the frontend dev server simultaneously.

1.  **Start the Backend Server:**
    *   Open a terminal in the project root (`finstruct`).
    *   Activate the virtual environment (if created): `source server/venv/bin/activate` (or Windows equivalent).
    *   Navigate to the server directory: `cd server`
    *   Run the server:
        ```bash
        python main.py
        # OR for auto-reload on code changes:
        # uvicorn main:app --host 127.0.0.1 --port 8000 --reload
        ```
    *   Keep this terminal open. Watch for messages indicating the model is loading and the server is listening on `http://127.0.0.1:8000`.

2.  **Start the Frontend Add-in Dev Server:**
    *   Open a *separate* terminal in the project root (`finstruct`).
    *   Navigate to the addin directory: `cd addin`
    *   Run the dev server and sideloading command:
        ```bash
        npm start
        ```
    *   This command will build the add-in, start a dev server (usually on `https://localhost:3000`), and attempt to open Excel and sideload the add-in for you.
    *   Keep this terminal open.

## How to Use

1.  **Sideloading:** If `npm start` doesn't automatically open Excel or sideload the add-in, you may need to do it manually:
    *   Ensure the dev server from `npm start` is running.
    *   Open Excel.
    *   Go to `Insert` > `Add-ins` > `My Add-ins`.
    *   Click `Upload My Add-in` at the bottom.
    *   Browse to the `finstruct/addin` directory and select `manifest.xml`.
    *   Click `Upload`.
2.  **Open Task Pane:** Click the "AI Assistant" button (or similar name, based on `manifest.xml`) on the Excel Ribbon (usually the Home tab) to open the task pane.
3.  **Enter Prompt:** Type your instructions for transforming the sheet into the text area.
4.  **Click Run:** The add-in will send the prompt (and placeholder sheet data) to the local LLM server.
5.  **View Suggestions:** The proposed operations from the LLM will appear under "Proposed Changes:".

## Current Status & Limitations (IMPORTANT)

*   **Excel Interaction Disabled:** Due to a persistent `Error: Load failed` when attempting to use the Office JavaScript API (`Excel.run`) to read from or write to the sheet, this functionality is currently **disabled** in the add-in code (`addin/src/taskpane.ts` and `addin/src/SheetConnector.ts`).
*   **Placeholder Data:** The add-in sends **static placeholder data** instead of the actual sheet content to the backend LLM server. The LLM's response is based on this placeholder data and your prompt.
*   **Apply Button Disabled:** The "Apply Approved" button appears but is non-functional because its click handler (which requires Excel interaction) is disabled.
*   **Focus:** The current state allows testing the **Prompt -> LLM -> Parsed Suggestions -> UI Display** loop. Further investigation is needed to resolve the underlying `Excel.run` / "Load failed" issue before sheet interaction (Phase 2/6) can be re-enabled. 