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
    console.log("Attempting to read fixed range A1:C3 for testing...");
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
}