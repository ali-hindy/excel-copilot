/* global Excel, console */

// Define the structure for an operation, matching the server's expectation
export interface ActionOp {
  id: string;
  range: string; // Excel A1 notation (e.g., "A1", "B2:C5")
  type: "write" | "formula" | "color";
  values?: any[]; // Used for type: "write"
  formula?: string; // Used for type: "formula"
  color?: string; // Used for type: "color"
  note?: string;
}

export class SheetConnector {
  /**
   * Reads the entire used range of the active worksheet.
   * @returns A promise that resolves with a 2D array of strings (sheet data).
   */
  async readSheet(): Promise<string[][]> {
    // console.log("Attempting to read fixed range A1:C3 for testing..."); // Remove misleading log
    try {
      return await Excel.run(async (context) => {
        const sheet = context.workbook.worksheets.getActiveWorksheet();
        
        // --- Restore reading the used range --- 
        console.log("Getting used range...");
        const range = sheet.getUsedRange(); 
        // const testRange = "A1:C3";
        // console.log(`Getting fixed range: ${testRange}`);
        // const range = sheet.getRange(testRange);
        // ----------------------------------------------------------

        // Try loading values with specific error handling
        try {
          console.log("Loading values for the range...");
          range.load("values");
          console.log("Calling context.sync()...");
          await context.sync();
          console.log("context.sync() completed. Returning values:", range.values);
          // Convert all values to strings
          return range.values.map(row => 
            row.map(cell => cell === null || cell === undefined ? "" : String(cell))
          );
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
   * Reads the currently selected range in the active worksheet.
   * @returns A promise that resolves with a 2D array of strings (selected range data).
   * @throws An error if no range is selected.
   */
  async getSelectedRangeData(): Promise<string[][]> {
    console.log("Attempting to read selected range...");
    try {
      return await Excel.run(async (context) => {
        const range = context.workbook.getSelectedRange();
        range.load("values"); // Load only values for now
        await context.sync();
        console.log("Selected range values loaded:", range.values);
        // Convert all values to strings
        return range.values.map(row => 
          row.map(cell => cell === null || cell === undefined ? "" : String(cell))
        );
      });
    } catch (error) {
      console.error("--- Error reading selected range --- ", error);
      if (error instanceof OfficeExtension.Error && error.code === "ItemNotFound") {
          // A more specific error can be thrown if needed, 
          // e.g., throw new Error("Please select a range in the worksheet first.");
          // For now, rethrow the original to be handled by the caller
          throw new Error("No range selected. Please select cells in the sheet.");
      } else if (error instanceof Error && error.message === "No range selected. Please select cells in the sheet.") {
          // Rethrow our specific error
          throw error;
      } else {
          // Handle other potential errors
          console.error("Unexpected error reading selected range:", error);
          throw new Error("An unexpected error occurred while reading the selected range.");
      }
    }
  }

  /**
   * Applies a list of operations to the active worksheet.
   * For P2, this will apply a hardcoded operation for testing.
   * @param ops An array of ActionOp objects.
   */
  async applyOps(ops: ActionOp[]): Promise<void> {
    console.log("Applying operations:", ops);
    try {
      await Excel.run(async (context) => {
        const sheet = context.workbook.worksheets.getActiveWorksheet();

        // Iterate through `ops` and apply them dynamically
        for (const op of ops) {
          console.log("Processing operation:", op);
          const targetRange = sheet.getRange(op.range);
          
          if (op.type === "write" && op.values) {
            // Check if the values are color names
            const firstValue = op.values[0]?.[0];
            if (typeof firstValue === 'string' && this.getColorHex(firstValue.toLowerCase())) {
              // If it's a color name, treat it as a color operation
              const colorHex = this.getColorHex(firstValue.toLowerCase());
              if (colorHex) {
                targetRange.format.font.color = colorHex;
                console.log("Font color set successfully to", colorHex);
              }
            } else {
              // Otherwise, treat it as a normal write operation
              targetRange.values = op.values;
            }
          } else if (op.type === "formula" && op.formula) {
            // If op.range is a single cell, formulas should be a 2D array
            if (targetRange.rowCount === 1 && targetRange.columnCount === 1) {
              targetRange.formulas = [[op.formula]];
            } else {
              // If the range is larger, fill all cells with the formula (may be improved)
              targetRange.formulas = Array(targetRange.rowCount)
                .fill([])
                .map(() => Array(targetRange.columnCount).fill(op.formula));
            }
          } else if (op.type === "color") {
            // First check op.color, then op.values[0], then default to black
            const colorName = op.color || (op.values && op.values.length > 0 ? op.values[0] : "black");
            console.log("Setting color:", colorName);
            const colorHex = this.getColorHex(colorName);
            if (colorHex) {
              // Set only font color, not fill
              targetRange.format.font.color = colorHex;
              console.log("Font color set successfully to", colorHex);
            } else {
              console.warn(`Invalid color specified: ${colorName}`);
            }
          } else {
            console.warn(`Unknown op type or missing data for op:`, op);
          }
        }

        await context.sync();
      });
      console.log("Finished applying operations.");
    } catch (error) {
      console.error("Error applying operations:", error);
      throw error;
    }
  }

  private getColorHex(colorName: string): string | null {
    const colorMap: { [key: string]: string } = {
      blue: "#4F81BD",    // Excel Accent 1
      green: "#9BBB59",   // Excel Accent 3
      red: "#FF0000",
      yellow: "#FFFF00",
      orange: "#FFA500",
      purple: "#800080",
      gray: "#808080",
      black: "#000000",
      white: "#FFFFFF"
    };
    return colorMap[colorName.toLowerCase()] || null;
  }

  /**
   * Gets the address of the currently selected range.
   * @returns A promise that resolves with the address string (e.g., "Sheet1!A1:C10").
   * @throws An error if no range is selected.
   */
  async getSelectedRangeAddress(): Promise<string> {
    console.log("Attempting to get selected range address...");
    try {
      return await Excel.run(async (context) => {
        const range = context.workbook.getSelectedRange();
        range.load("address");
        await context.sync();
        console.log("Selected range address loaded:", range.address);
        return range.address;
      });
    } catch (error) {
      console.error("--- Error getting selected range address --- ", error);
      if (error instanceof OfficeExtension.Error && error.code === "ItemNotFound") {
          throw new Error("No range selected. Please select cells in the sheet.");
      } else {
          console.error("Unexpected error getting selected range address:", error);
          throw new Error("An unexpected error occurred while getting the selected range address.");
      }
    }
  }

  /**
   * Reads data from a specific range address.
   * @param address The range address (e.g., "Sheet1!A1:C10").
   * @returns A promise that resolves with a 2D array of strings (range data).
   */
  async getRangeData(address: string): Promise<string[][]> {
    console.log(`Attempting to read data from range: ${address}`);
    try {
      return await Excel.run(async (context) => {
        const sheet = context.workbook.worksheets.getActiveWorksheet(); // Assuming active sheet for now
        const range = sheet.getRange(address);
        range.load("values");
        await context.sync();
        console.log(`Data loaded from ${address}:`, range.values);
        // Convert all values to strings
        return range.values.map(row => 
          row.map(cell => cell === null || cell === undefined ? "" : String(cell))
        );
      });
    } catch (error) {
      console.error(`--- Error reading data from range ${address} --- `, error);
      throw new Error(`Failed to read data from range ${address}.`); // Generic error for simplicity
    }
  }
}