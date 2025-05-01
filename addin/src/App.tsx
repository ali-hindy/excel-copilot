import React, { useState, useEffect, useRef } from "react";
import { ChatView } from "./components/ChatView";
import { PreviewPane } from "./components/PreviewPane";
import { SheetConnector, ActionOp } from "./SheetConnector";
import { ChatService } from "./services/chatService";

export default function App() {
  const [slots, setSlots] = useState<any>({
    roundType: undefined,
    amount: undefined,
    preMoney: undefined,
    poolPct: undefined,
  });
  const [isReady, setIsReady] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [planOps, setPlanOps] = useState<ActionOp[]>([]);
  const [selectedRangeAddress, setSelectedRangeAddress] = useState<string | null>(null);
  const [planTaskId, setPlanTaskId] = useState<string | null>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const [sheetConnector] = useState(() => new SheetConnector());
  const [chatService] = useState(() => new ChatService("https://efa332809648.ngrok.app"));

  const handleSlotsReady = (filledSlots: any) => {
    console.log("Slots ready:", filledSlots);
    setSlots(filledSlots);
    setIsReady(true);
    setPlanOps([]);
    setErrorMessage(null);
    setSelectedRangeAddress(null);
    setPlanTaskId(null);
    if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
  };

  const handleChatError = (message: string) => {
    setErrorMessage(message);
    setIsLoading(false);
  };

  const checkPlanStatus = async (taskId: string) => {
    if (!taskId) return;
    console.log(`Checking status for task: ${taskId}`);
    try {
      const statusResponse = await chatService.getPlanResult(taskId);
      console.log("Poll response:", statusResponse);

      if (statusResponse.status === "completed") {
        console.log("Plan generation completed!");
        if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
        setPlanOps(statusResponse.result.ops || []);
        setIsLoading(false);
        setPlanTaskId(null);
        setSelectedRangeAddress(null);
      } else if (statusResponse.status === "failed") {
        console.error("Plan generation failed:", statusResponse.error);
        if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
        setErrorMessage(`Plan generation failed: ${statusResponse.error || "Unknown error"}`);
        setIsLoading(false);
        setPlanTaskId(null);
      } else {
        console.log("Plan still processing...");
      }
    } catch (error: any) {
      console.error("Error during polling:", error);
      if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
      setErrorMessage(`Error checking plan status: ${error.message}`);
      setIsLoading(false);
      setPlanTaskId(null);
    }
  };

  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, []);

  const handleGeneratePlan = async () => {
    if (!selectedRangeAddress) {
      setIsLoading(true);
      setErrorMessage(null);
      try {
        console.log("Attempting to get selected range address...");
        const address = await sheetConnector.getSelectedRangeAddress();
        setSelectedRangeAddress(address);
        console.log("Selected range address confirmed:", address);
      } catch (error: any) {
        console.error("Error getting selected range address:", error);
        setErrorMessage(error.message || "Failed to get selected range address.");
        setSelectedRangeAddress(null);
      } finally {
        setIsLoading(false);
      }
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    setPlanOps([]);

    try {
      console.log(`Reading sheet data from confirmed range: ${selectedRangeAddress}...`);
      const sheetData = await sheetConnector.getRangeData(selectedRangeAddress);
      console.log("Sheet data read from confirmed range.");

      const formattedSheetData = sheetData.map((row) =>
        row.map((cell) => (cell === null || cell === undefined ? "" : String(cell)))
      );

      console.log("Requesting plan generation...");
      const initialResponse = await chatService.generatePlan(slots, formattedSheetData);

      if (initialResponse && initialResponse.task_id) {
        console.log(`Plan generation started with Task ID: ${initialResponse.task_id}`);
        setPlanTaskId(initialResponse.task_id);
        setIsLoading(true);
        pollingIntervalRef.current = setInterval(() => {
          checkPlanStatus(initialResponse.task_id);
        }, 10000);
      } else {
        throw new Error("Failed to start plan generation task.");
      }
    } catch (error: any) {
      console.error("Error generating plan:", error);
      setErrorMessage(error.message || "Failed to generate plan. Please check logs.");
      setIsLoading(false);
      setPlanTaskId(null);
    }
  };

  const handleApplyPlan = async (approvedOps: ActionOp[]) => {
    if (!approvedOps || approvedOps.length === 0) {
      setErrorMessage("No operations selected to apply.");
      return;
    }
    setIsLoading(true);
    setErrorMessage(null);
    try {
      console.log("Applying operations:", approvedOps);
      await sheetConnector.applyOps(approvedOps);
      console.log("Operations applied successfully.");
      setPlanOps([]);
      setIsReady(false);
      setSlots({
        roundType: undefined,
        amount: undefined,
        preMoney: undefined,
        poolPct: undefined,
      });
    } catch (error: any) {
      console.error("Error applying plan:", error);
      setErrorMessage(error.message || "Failed to apply plan. Check console.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    // Use ms-Fabric for some basic Office styling, add padding
    <div className="app" dir="ltr" style={appStyles.container}>
      {/* <SlotStatusBar slots={slots} /> */}
      {/* Remove rendering */}

      {/* Add flex-grow to ChatView/PreviewPane containers */}
      <div id="react-container" className="flex flex-col justify-center" style={appStyles.mainContent}>
        {/* Restore conditional rendering */}
        {!isReady && planOps.length === 0 && (
          <ChatView
            chatService={chatService}
            onReady={handleSlotsReady}
            onError={handleChatError}
            isLoading={isLoading}
          />
        )}

        {isReady && planOps.length === 0 && (
          <div className="p-3  border border-black/50 rounded-lg  bg-white/20 backdrop-blur-md shadow-xl">
            <h4 className="text-lg font-semibold mb-2 text-black">Parameters</h4>
            <p className="text-md text-black  mb-4">
              {selectedRangeAddress
                ? `Selected Range: ${selectedRangeAddress}`
                : "Please select the relevant data range in your sheet."}
            </p>
          <div id="react-buttons" className="flex flex-col items-center font-bold w-full gap-2 *:w-[80%] *:flex *:justify-center *:py-2">
              {selectedRangeAddress && (
                <button
                  className="bg-black text-white border border-gray-600 rounded-lg cursor-pointer hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={() => setSelectedRangeAddress(null)}
                  disabled={isLoading}
                >
                  Change Selection
                </button>
              )}
              <button
                className={`rounded-lg cursor-pointer ${
                  isLoading
                    ? "bg-gray-700 text-gray-400 cursor-not-allowed"
                    : "bg-black text-white hover:bg-gray-800"
                }`}
                onClick={handleGeneratePlan}
                disabled={isLoading}
              >
                {isLoading
                  ? planTaskId
                    ? "Generating Plan (takes ~4min)..."
                    : "Getting Selection..."
                  : selectedRangeAddress
                    ? "Confirm and Generate Plan"
                    : "Get selected range"}
              </button>
            </div>
          </div>
        )}

        {planOps.length > 0 && (
          <PreviewPane ops={planOps} onApply={handleApplyPlan} isLoading={isLoading} />
        )}
      </div>

      {/* Footer for messages */}
      <div style={appStyles.footer}>
        {errorMessage && <div style={appStyles.errorMessage}>Error: {errorMessage}</div>}

        {isLoading && (
          <div style={appStyles.loadingIndicator}>
            {planTaskId ? "Generating plan... (this may take up to 5 minutes)" : "Processing..."}
          </div>
        )}
      </div>
    </div>
  );
}

// Basic inline styles (consider moving to CSS Modules or a styled-components approach later)
const appStyles: { [key: string]: React.CSSProperties } = {
  container: {
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    padding: "15px",
    boxSizing: "border-box",
    fontFamily: '"Segoe UI", system-ui, sans-serif', // Use Office Fabric font
    // backgroundColor: 'lightblue' // DEBUG: Remove Container background
  },
  mainContent: {
    flexGrow: 1,
    display: "flex",
    flexDirection: "column",
    overflowY: "auto", // Allow content to scroll if needed
    marginBottom: "10px",
    // backgroundColor: 'lightcoral' // DEBUG: Remove Main content background
  },
  planTriggerContainer: {
    padding: "15px",
    border: "1px solid #eee",
    borderRadius: "4px",
    backgroundColor: "#f9f9f9",
    marginTop: "10px",
  },
  instructionText: {
    fontSize: "0.9em",
    color: "#555",
    marginBottom: "10px",
  },
  parameterList: {
    listStyle: "none",
    paddingLeft: "0",
    fontSize: "0.9em",
  },
  button: {
    padding: "8px 16px",
    backgroundColor: "#000", // Office blue
    color: "white",
    border: "none",
    borderRadius: "2px",
    cursor: "pointer",
    fontSize: "1em",
  },
  secondaryButton: {
    backgroundColor: "#f0f0f0",
    color: "#000",
    border: "1px solid #ccc",
  },
  buttonDisabled: {
    backgroundColor: "#c7e0f4", // Lighter blue
    cursor: "not-allowed",
  },
  footer: {
    minHeight: "40px", // Ensure footer has some height even when empty
    marginTop: "auto", // Push footer to bottom
    // backgroundColor: 'lightgoldenrodyellow' // DEBUG: Remove Footer background
  },
  errorMessage: {
    color: "#a80000", // Office error red
    marginTop: "10px",
    padding: "10px",
    border: "1px solid #fde7e9",
    backgroundColor: "#fde7e9", // Light red background
    borderRadius: "2px",
  },
  loadingIndicator: {
    marginTop: "10px",
    padding: "10px",
    fontStyle: "italic",
    color: "#555",
  },
};
