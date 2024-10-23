import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';

export async function activate(context: vscode.ExtensionContext) {
    let disposable = vscode.commands.registerCommand('dart-barrel-generator.generateBarrel', async (uri: vscode.Uri) => {
        try {
            // Get the target folder
            if (!uri || !uri.fsPath) {
                const message = 'Please right-click on a folder to generate a barrel file';
                vscode.window.showErrorMessage(message);
                return;
            }

            const stats = await fs.stat(uri.fsPath);
            if (!stats.isDirectory()) {
                vscode.window.showErrorMessage('Please select a folder, not a file');
                return;
            }

            const folderPath = uri.fsPath;
            const folderName = path.basename(folderPath);
            const barrelFilePath = path.join(folderPath, `${folderName}.dart`);

            // Check if barrel file already exists
            try {
                await fs.access(barrelFilePath);
                const override = await vscode.window.showWarningMessage(
                    `${folderName}.dart already exists. Do you want to override it?`,
                    'Yes', 'No'
                );
                if (override !== 'Yes') {
                    return;
                }
            } catch (error) {
                // File doesn't exist, which is fine
            }

            // Start the barrel generation process
            const exports = await generateExports(folderPath, folderPath);
            const sortedExports = exports.sort((a, b) => a.localeCompare(b));
            const fileContent = sortedExports.join('\n') + '\n';

            // Write the barrel file
            await fs.writeFile(barrelFilePath, fileContent, 'utf8');

            // Update imports in all files
            await updateImports(folderPath, folderName, folderPath);

            vscode.window.showInformationMessage(
                `Successfully generated barrel file: ${folderName}.dart`
            );

        } catch (error) {
            vscode.window.showErrorMessage(
                `Error generating barrel file: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    });

    context.subscriptions.push(disposable);
}

async function generateExports(basePath: string, currentPath: string): Promise<string[]> {
    const exports: string[] = [];
    const files = await fs.readdir(currentPath, { withFileTypes: true });

    for (const file of files) {
        const filePath = path.join(currentPath, file.name);
        
        // Skip hidden files and directories
        if (file.name.startsWith('.')) {
            continue;
        }

        if (file.isDirectory()) {
            // Recursively process subdirectories
            const subExports = await generateExports(basePath, filePath);
            exports.push(...subExports);
        } else if (
            file.isFile() && 
            file.name.endsWith('.dart') && 
            !file.name.endsWith('.g.dart') && 
            !file.name.endsWith('.freezed.dart') &&
            !file.name.endsWith('.mocks.dart')
        ) {
            // Skip generated files and the barrel file itself
            const relativePath = path.relative(basePath, filePath);
            if (path.basename(filePath) !== path.basename(basePath) + '.dart') {
                // Ensure forward slashes for Dart imports
                const dartPath = relativePath.split(path.sep).join('/');
                exports.push(`export '${dartPath}';`);
            }
        }
    }

    return exports;
}

async function updateImports(basePath: string, barrelName: string, currentPath: string) {
    const files = await fs.readdir(currentPath, { withFileTypes: true });

    for (const file of files) {
        const filePath = path.join(currentPath, file.name);
        
        // Skip hidden files and directories
        if (file.name.startsWith('.')) {
            continue;
        }

        if (file.isDirectory()) {
            // Recursively process subdirectories
            await updateImports(basePath, barrelName, filePath);
        } else if (
            file.isFile() && 
            file.name.endsWith('.dart') && 
            !file.name.endsWith('.g.dart') && 
            !file.name.endsWith('.freezed.dart') &&
            !file.name.endsWith('.mocks.dart')
        ) {
            if (path.basename(filePath) !== barrelName + '.dart') {
                await updateFileImports(filePath, basePath, barrelName);
            }
        }
    }
}

async function updateFileImports(filePath: string, basePath: string, barrelName: string) {
    let content = await fs.readFile(filePath, 'utf8');
    const importRegex = /import\s+'([^']+)';/g;
    const imports = Array.from(content.matchAll(importRegex));

    let modified = false;
    for (const match of imports) {
        const importPath = match[1];
        // Only process relative imports
        if (importPath.startsWith('./') || importPath.startsWith('../')) {
            try {
                const absoluteImportPath = path.resolve(path.dirname(filePath), importPath);
                const relativeToBase = path.relative(basePath, absoluteImportPath);
                
                // Only update imports that are within the barrel's directory
                if (!relativeToBase.startsWith('..') && !relativeToBase.includes('node_modules')) {
                    const newImport = `import '${barrelName}.dart';`;
                    content = content.replace(match[0], newImport);
                    modified = true;
                }
            } catch (error) {
                console.error(`Error processing import in ${filePath}: ${error}`);
            }
        }
    }

    if (modified) {
        await fs.writeFile(filePath, content, 'utf8');
    }
}

export function deactivate() {}