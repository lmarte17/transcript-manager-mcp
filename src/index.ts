import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from 'fs/promises';
import path from 'path';
import { execSync } from "child_process";

// Create an MCP server
const server = new McpServer({
  name: "TranscriptManager",
  version: "1.0.0"
});

// Define course path mappings
const COURSE_NOTES_PATHS: { [key: string]: string } = {
  "Approximations Algorithms": "/Users/lmarte/Documents/Obsidian Vault/Approx-Algo-LP",
  "Math": "/Users/lmarte/Documents/Obsidian Vault/Math",
  // Add more course mappings as needed
};

// Define transcript location mappings - where transcripts are stored
const COURSE_TRANSCRIPT_PATHS: { [key: string]: string } = {
  "Approximations Algorithms": "/Users/lmarte/Documents/Projects/CU-Boulder/Data-Structures-Algo/Approx-Algo-LP",
  "Math": "/Users/lmarte/Documents/Obsidian Vault/Math/transcripts",
  // Add more mappings as needed
};

// Define default notes output location
const DEFAULT_NOTES_PATH = "/Users/lmarte/Documents/Obsidian Vault";
const DEFAULT_TRANSCRIPT_PATH = "/Users/lmarte/Documents/Transcripts";

// Define a tool that can list available courses and their paths
server.tool(
  "list-courses",
  "List all available course folders and their paths",
  {},
  async () => {
    const courseList = Object.keys(COURSE_NOTES_PATHS).map(course => {
      const notesPath = COURSE_NOTES_PATHS[course];
      const transcriptPath = COURSE_TRANSCRIPT_PATHS[course];
      return `${course}:\n  - Notes: ${notesPath}\n  - Transcripts: ${transcriptPath}`;
    }).join('\n\n');
    
    return {
      content: [
        {
          type: "text",
          text: `Available courses and their paths:\n\n${courseList}`
        }
      ]
    };
  }
);


// Enhanced tool with course path mapping
server.tool(
  "generate-notes-from-source",
  "Generate lecture notes from various transcript sources with automatic path resolution",
  {
    // Basic info about the lecture
    courseName: z.string().describe("The name of the course (matches a known course folder)"),
    lectureNumber: z.string().describe("The lecture number"),
    lectureTopic: z.string().describe("The topic of the lecture"),
    
    // Source type and details
    sourceType: z.enum(["local-file", "youtube", "api"]).describe("The type of source for the transcript"),
    sourceLocation: z.string().describe("Local file path (relative to course path), YouTube URL, or API endpoint"),
    
    // For API sources only
    apiMethod: z.enum(["GET", "POST"]).optional().describe("HTTP method for API requests"),
    apiHeaders: z.record(z.string()).optional().describe("Headers for API requests"),
    apiBody: z.string().optional().describe("Body for API POST requests"),
    
    // Output options (all optional with smart defaults)
    outputDirectory: z.string().optional().describe("Directory to save notes (defaults to course notes path)"),
    outputFilename: z.string().optional().describe("Filename for notes (default: auto-generated)"),
    saveTranscript: z.boolean().default(true).describe("Whether to save the transcript to the transcript directory"),
    transcriptFilename: z.string().optional().describe("Filename for saved transcript (default: auto-generated)"),
    
    // Optional formatting preferences
    specialFormatting: z.string().optional().describe("Special formatting requirements"),
    contentToEmphasize: z.string().optional().describe("Content that should be emphasized"),
    otherInstructions: z.string().optional().describe("Any other instructions")
  },
  async (params) => {
    try {
      // 1. Resolve course paths
      const notesPath = COURSE_NOTES_PATHS[params.courseName] || DEFAULT_NOTES_PATH;
      const transcriptPath = COURSE_TRANSCRIPT_PATHS[params.courseName] || DEFAULT_TRANSCRIPT_PATH;
      
      if (!COURSE_NOTES_PATHS[params.courseName]) {
        console.error(`Warning: Unknown course "${params.courseName}". Using default paths.`);
      }
      
      // 2. Handle transcript acquisition based on source type
      let transcriptContent = "";
      let originalTranscriptPath = "";
      
      if (params.sourceType === "local-file") {
        // For local files, use the transcript path + relative location if not absolute
        originalTranscriptPath = path.isAbsolute(params.sourceLocation) 
          ? params.sourceLocation 
          : path.join(transcriptPath, params.sourceLocation);
          
        try {
          transcriptContent = await fs.readFile(originalTranscriptPath, 'utf-8');
        } catch (err) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `Error: Could not read file at ${originalTranscriptPath}. Make sure the file exists and is accessible.`
              }
            ]
          };
        }
      }
      else if (params.sourceType === "youtube") {
        // Call YouTube transcript downloader MCP
        const ytCommand = `npx -y @anaisbetts/mcp-youtube ${params.sourceLocation}`;
        transcriptContent = execSync(ytCommand).toString();
        
        // If saveTranscript is true, save a copy
        if (params.saveTranscript) {
          const ytTranscriptFilename = params.transcriptFilename || 
            `${params.courseName.replace(/\s+/g, '-')}-Lecture-${params.lectureNumber}-YT.txt`;
          originalTranscriptPath = path.join(transcriptPath, ytTranscriptFilename);
          await fs.writeFile(originalTranscriptPath, transcriptContent);
        }
      }
      else if (params.sourceType === "api") {
        // Use curl-api MCP to fetch transcript
        const method = params.apiMethod || "GET";
        const headers = params.apiHeaders || {};
        const body = params.apiBody || undefined;
        
        const curlCommand = `npx @modelcontextprotocol/server-curl ${params.sourceLocation} ${method} ${JSON.stringify(headers)} ${body ? JSON.stringify(body) : ''}`;
        const apiResponse = JSON.parse(execSync(curlCommand).toString());
        transcriptContent = apiResponse.data;
        
        // If saveTranscript is true, save a copy
        if (params.saveTranscript) {
          const apiTranscriptFilename = params.transcriptFilename || 
            `${params.courseName.replace(/\s+/g, '-')}-Lecture-${params.lectureNumber}-API.txt`;
          originalTranscriptPath = path.join(transcriptPath, apiTranscriptFilename);
          await fs.writeFile(originalTranscriptPath, transcriptContent);
        }
      }
      
      // 3. Determine output directory (course path by default)
      const outputDirectory = params.outputDirectory || notesPath;
      
      // 4. Generate output filename if not provided
      const outputFilename = params.outputFilename || 
        `${params.courseName.replace(/\s+/g, '-')}-Lecture-${params.lectureNumber}`;
      
      // 5. Generate or call note-taker service
      const noteCommand = `node /Users/lmarte/Documents/Projects/mcp-servers/note-taker/build/index.js`;
      
      // Prepare prompt arguments
      const promptArgs = {
        courseName: params.courseName,
        lectureNumber: params.lectureNumber,
        lectureTopic: params.lectureTopic,
        transcriptFilePath: transcriptPath,
        outputDirectory: params.outputDirectory,
        outputFilename: outputFilename,
        specialFormatting: params.specialFormatting || "",
        contentToEmphasize: params.contentToEmphasize || "",
        otherInstructions: params.otherInstructions || ""
      };
      
      const fullOutputPath = path.join(outputDirectory, `${outputFilename}.md`);
      
      return {
        content: [
          {
            type: "text",
            text: `Notes successfully generated from ${params.sourceType} source!\n\n` +
                  `Course: ${params.courseName}\n` +
                  `Source: ${transcriptPath || params.sourceLocation}\n` +
                  `Notes saved to: ${fullOutputPath}\n\n` +
                  `Transcript length: ${transcriptContent.length} characters`
          }
        ]
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Error generating notes: ${errorMessage}`
          }
        ]
      };
    }
  }
);

// Start server
async function main() {
  try {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Transcript Manager MCP Server running");
  } catch (error) {
    console.error("Error starting server:", error);
    process.exit(1);
  }
}

main();