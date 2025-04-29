/* global Excel, console */

// Define the structure for an operation, matching the server's expectation
export interface ActionOp {
  id: string;
  range: string; // Excel A1 notation (e.g., "A1", "B2:C5")
  type: "write" | "formula";
  values?: string[][]; // Used for type: "write"
  formula?: string; // Used for type: "formula"
  note?: string;
}

/**
 * Reads the entire used range of the active worksheet.
 * @returns A promise that resolves with a 2D array of strings (sheet data).
 */
export async function readSheet(): Promise<string[][]> {
  console.log("Attempting to read fixed range A1:C3 for testing...");
  try {
    return await Excel.run(async (context) => {
      const sheet = context.workbook.worksheets.getActiveWorksheet();
      // --- TESTING: Use a fixed range instead of getUsedRange ---
      const testRange = "A1:C3";
      console.log(`Getting fixed range: ${testRange}`);
      const range = sheet.getRange(testRange);
      // ----------------------------------------------------------

      // Try loading values with specific error handling
      try {
        console.log("Loading values for the range...");
        range.load("values");
        console.log("Calling context.sync()...");
        await context.sync();
        console.log("context.sync() completed. Returning values:", range.values);
        return range.values;
      } catch (loadError) {
        console.error("--- Error details during range.load/sync in readSheet --- ");
        console.error("Original Error Object:", loadError); // Log the full object
        if (loadError instanceof OfficeExtension.Error) {
          console.error(`OfficeExtension Error Code: ${loadError.code}`);
          console.error(`OfficeExtension Error Message: ${loadError.message}`);
          console.error(`OfficeExtension Error Debug Info: ${JSON.stringify(loadError.debugInfo)}`);
        }
        // Rethrow the original error object to preserve details
        throw loadError;
      }
    });
  } catch (error) {
    // Handle potential errors like a blank sheet from getUsedRange (less likely now)
    // if (error instanceof OfficeExtension.Error && error.code === 'ItemNotFound') { ... }

    // Catch other errors (including the rethrown loadError)
    console.error("--- Error caught in outer catch block of readSheet --- ");
    console.error("Error Object:", error);
    throw error; // Re-throw to be caught by the caller (run function)
  }
}

/**
 * Applies a list of operations to the active worksheet.
 * For P2, this will apply a hardcoded operation for testing.
 * @param ops An array of ActionOp objects.
 */
export async function applyOps(ops: ActionOp[]): Promise<void> {
  console.log("Applying operations (P2 - hardcoded test):", ops);
  try {
    await Excel.run(async (context) => {
      const sheet = context.workbook.worksheets.getActiveWorksheet();

      // Iterate through `ops` and apply them dynamically
      for (const op of ops) {
        const targetRange = sheet.getRange(op.range);
        if (op.type === "write" && op.values) {
          targetRange.values = op.values;
        } else if (op.type === "formula" && op.formula) {
          // Set the formulas for the entire range using a 2D array.
          // Providing [[formula]] should broadcast to the entire range.
          targetRange.formulas = [[op.formula]];
        } else {
          console.warn(`Unknown op type or missing data for op:`, op);
        }
        // Optionally: handle op.note or formatting here
      }

      await context.sync();
    });
    console.log("Finished applying operations.");
  } catch (error) {
    console.error("Error applying operations:", error);
    throw error; // Re-throw error
  }
}
