import * as fs from 'fs';
import * as path from 'path';

interface TactFile {
    name: string;
    relativePath: string;
    content: string;
}

/**
 * Recursively finds all .tact files in a directory
 * @param dir - Directory to search in
 * @param baseDir - Base directory for relative path calculation
 * @param files - Accumulator for found files
 * @returns Array of TactFile objects
 */
function findTactFiles(dir: string, baseDir: string, files: TactFile[] = []): TactFile[] {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
            // Recursively search subdirectories
            findTactFiles(fullPath, baseDir, files);
        } else if (entry.isFile() && entry.name.endsWith('.tact')) {
            // Read file content
            const content = fs.readFileSync(fullPath, 'utf-8');
            const relativePath = path.relative(baseDir, fullPath);

            files.push({
                name: entry.name,
                relativePath: relativePath,
                content: content
            });
        }
    }

    return files;
}

/**
 * Formats the collected files into a readable output
 * @param files - Array of TactFile objects
 * @returns Formatted string output
 */
function formatOutput(files: TactFile[]): string {
    let output = `# Tact Project Files Collection\n\n`;
    output += `Total files found: ${files.length}\n\n`;
    output += `${'='.repeat(80)}\n\n`;

    files.forEach((file, index) => {
        output += `## File ${index + 1}: ${file.name}\n`;
        output += `**Path:** ${file.relativePath}\n\n`;
        output += `\`\`\`tact\n${file.content}\n\`\`\`\n\n`;
        output += `${'='.repeat(80)}\n\n`;
    });

    return output;
}

/**
 * Main function to collect and save Tact files
 * @param targetDir - Directory to scan
 * @param outputFile - Output file name (optional)
 */
function collectTactFiles(targetDir: string, outputFile: string = 'tact_project_collection.md'): void {
    try {
        // Check if directory exists
        if (!fs.existsSync(targetDir)) {
            console.error(`Error: Directory "${targetDir}" does not exist.`);
            process.exit(1);
        }

        // Get absolute path
        const absolutePath = path.resolve(targetDir);
        console.log(`Scanning directory: ${absolutePath}`);

        // Find all .tact files
        const tactFiles = findTactFiles(absolutePath, absolutePath);

        if (tactFiles.length === 0) {
            console.log('No .tact files found in the specified directory.');
            return;
        }

        // Sort files by relative path for better organization
        tactFiles.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

        // Format output
        const output = formatOutput(tactFiles);

        // Save to file
        fs.writeFileSync(outputFile, output, 'utf-8');
        console.log(`\nSuccess! Found ${tactFiles.length} .tact files.`);
        console.log(`Output saved to: ${outputFile}`);

        // Also create a JSON version for programmatic use
        const jsonOutput = {
            scanDate: new Date().toISOString(),
            baseDirectory: absolutePath,
            filesCount: tactFiles.length,
            files: tactFiles
        };

        const jsonFileName = outputFile.replace(/\.[^/.]+$/, '') + '.json';
        fs.writeFileSync(jsonFileName, JSON.stringify(jsonOutput, null, 2), 'utf-8');
        console.log(`JSON output saved to: ${jsonFileName}`);

    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

// CLI usage
if (require.main === module) {
    const args = process.argv.slice(2);

    if (args.length === 0) {
        console.log('Usage: ts-node collect-tact-files.ts <directory> [output-file]');
        console.log('Example: ts-node collect-tact-files.ts ./src tact_collection.md');
        process.exit(1);
    }

    const targetDir = args[0];
    const outputFile = args[1] || 'tact_project_collection.md';

    collectTactFiles(targetDir, outputFile);
}

// Export for use as a module
export { collectTactFiles, findTactFiles, formatOutput };