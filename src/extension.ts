import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';

export async function activate(context: vscode.ExtensionContext) {
    let disposable = vscode.commands.registerCommand('dart-barrel-generator.generateBarrel', async (uri: vscode.Uri) => {
        try {
            if (!uri || !uri.fsPath) {
                vscode.window.showErrorMessage('Please right-click on a folder to generate a barrel file');
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

            // Collect all imports and exports
            const { imports, exports } = await generateBarrelContent(folderPath, folderPath);
            
            // Remove duplicates and sort
            const uniqueImports = Array.from(new Set(imports)).sort();
            const uniqueExports = Array.from(new Set(exports)).sort();

            // Combine imports and exports
            const fileContent = [
                ...uniqueImports.map(imp => `import '${imp}';`),
                '', // Empty line between imports and exports
                ...uniqueExports.map(exp => `export '${exp}';`),
                '' // Final newline
            ].join('\n');

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

async function generateBarrelContent(basePath: string, currentPath: string): Promise<{ imports: string[], exports: string[] }> {
    const imports: string[] = [];
    const exports: string[] = [];
    const files = await fs.readdir(currentPath, { withFileTypes: true });

    for (const file of files) {
        const filePath = path.join(currentPath, file.name);
        
        if (file.name.startsWith('.')) {
            continue;
        }

        if (file.isDirectory()) {
            const subContent = await generateBarrelContent(basePath, filePath);
            imports.push(...subContent.imports);
            exports.push(...subContent.exports);
        } else if (
            file.isFile() && 
            file.name.endsWith('.dart') && 
            !file.name.endsWith('.g.dart') && 
            !file.name.endsWith('.freezed.dart') &&
            !file.name.endsWith('.mocks.dart')
        ) {
            if (path.basename(filePath) !== path.basename(basePath) + '.dart') {
                const content = await fs.readFile(filePath, 'utf8');
                
                // Extract all imports
                const importMatches = content.match(/import\s+'([^']+)';/g) || [];
                const extractedImports = importMatches.map(imp => {
                    const match = imp.match(/import\s+'([^']+)';/);
                    return match ? match[1] : '';
                }).filter(imp => imp);
                
                imports.push(...extractedImports);

                // Add file to exports
                const relativePath = path.relative(basePath, filePath);
                const dartPath = relativePath.split(path.sep).join('/');
                exports.push(dartPath);
            }
        }
    }

    return { imports, exports };
}

async function updateImports(basePath: string, barrelName: string, currentPath: string) {
    const files = await fs.readdir(currentPath, { withFileTypes: true });

    for (const file of files) {
        const filePath = path.join(currentPath, file.name);
        
        if (file.name.startsWith('.')) {
            continue;
        }

        if (file.isDirectory()) {
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
                    // Calculate the relative path from the current file to the barrel file
                    const relativeToBarrel = path.relative(
                        path.dirname(filePath),
                        path.join(basePath, `${barrelName}.dart`)
                    );
                    
                    // Ensure proper path format for Dart imports
                    const dartPath = relativeToBarrel.split(path.sep).join('/');
                    const newImport = `import '${dartPath.startsWith('.') ? dartPath : './' + dartPath}';`;
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