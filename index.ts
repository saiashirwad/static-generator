#!/usr/bin/env bun
import { access, mkdir, readdir, stat } from "node:fs/promises";
import { basename, dirname, extname, join, relative } from "node:path";

// ========================================
// Global Configuration
// Edit these values instead of passing command line args
// ========================================
const DEFAULT_CONFIG: SiteConfig = {
  contentDir: './content',
  outputDir: './public',
  layoutDir: './layouts',
  defaultLayout: 'default',
  siteTitle: 'texoport',
  cssFile: './content/styles.css',
  serve: true,  // Set to true to automatically serve after building
  port: 3000,
  // Add any other site-wide configuration here
  siteDescription: 'A minimalist static site generator built with Bun',
  siteAuthor: 'Your Name',
  basePath: '/', // Base URL path if site is not at root
};
// ========================================

interface SiteConfig {
  contentDir: string;
  outputDir: string;
  cssFile?: string;
  layoutDir?: string;
  defaultLayout?: string;
  siteTitle?: string;
  serve?: boolean;
  port?: number;
  // Additional custom fields
  siteDescription?: string;
  siteAuthor?: string;
  basePath?: string;
  [key: string]: any; // Allow for additional custom properties
}

// Front Matter interface
interface FrontMatter {
  title?: string;
  date?: string;
  description?: string;
  layout?: string;
  tags?: string[];
  image?: string;
  author?: string;
  github?: string;
  demo?: string;
  category?: string;
  draft?: boolean;
  [key: string]: any; // Allow for any additional front matter properties
}

// Extract front matter from markdown content
function extractFrontMatter(content: string): { frontMatter: FrontMatter; content: string } {
  // Default empty front matter
  const defaultResult = {
    frontMatter: {},
    content: content
  };
  
  // Check if content starts with front matter delimiter
  if (!content.startsWith('---')) {
    return defaultResult;
  }
  
  // Find the closing delimiter
  const endOfFrontMatter = content.indexOf('---', 3);
  if (endOfFrontMatter === -1) {
    console.warn('Front matter appears to be improperly formatted (missing closing delimiter)');
    return defaultResult;
  }
  
  // Extract the front matter content
  const frontMatterRaw = content.substring(3, endOfFrontMatter).trim();
  
  // Extract the content after front matter
  const contentWithoutFrontMatter = content.substring(endOfFrontMatter + 3).trim();
  
  // Parse the front matter as key-value pairs
  const frontMatter: FrontMatter = {};
  
  try {
    // Parse each line in the front matter
    const lines = frontMatterRaw.split('\n');
    for (const line of lines) {
      const colonIndex = line.indexOf(':');
      if (colonIndex > 0) {
        const key = line.substring(0, colonIndex).trim();
        let value = line.substring(colonIndex + 1).trim();
        
        // Handle arrays in square brackets
        if (value.startsWith('[') && value.endsWith(']')) {
          try {
            // Remove brackets and split by commas
            const arrayString = value.substring(1, value.length - 1);
            if (arrayString.trim()) {
              const items = arrayString.split(',').map(item => item.trim());
              frontMatter[key] = items;
            } else {
              frontMatter[key] = [];
            }
          } catch (e) {
            console.warn(`Failed to parse array value for ${key}: ${value}`);
            frontMatter[key] = value;
          }
        } else {
          frontMatter[key] = value;
        }
      }
    }
    
    console.log(`📄 Extracted front matter:`, frontMatter);
    
    return {
      frontMatter,
      content: contentWithoutFrontMatter
    };
  } catch (error) {
    console.warn(`Failed to parse front matter: ${error}`);
    return defaultResult;
  }
}

// Simple Markdown to HTML converter that preserves HTML
function markdownToHtml(markdown: string): string {
  // Convert headers
  let html = markdown
    .replace(/^# (.*$)/gm, '<h1>$1</h1>')
    .replace(/^## (.*$)/gm, '<h2>$1</h2>')
    .replace(/^### (.*$)/gm, '<h3>$1</h3>')
    .replace(/^#### (.*$)/gm, '<h4>$1</h4>')
    .replace(/^##### (.*$)/gm, '<h5>$1</h5>')
    .replace(/^###### (.*$)/gm, '<h6>$1</h6>');

  // Convert paragraphs (empty lines between text) - but not lines that start with HTML tags
  html = html.replace(/^(?!<)([^<].*)\n$/gm, '<p>$1</p>');
  
  // Convert links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  
  // Convert bold and italic text
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  
  // Convert lists
  html = html.replace(/^\* (.*$)/gm, '<ul><li>$1</li></ul>');
  html = html.replace(/^- (.*$)/gm, '<ul><li>$1</li></ul>');
  html = html.replace(/^[0-9]+\. (.*$)/gm, '<ol><li>$1</li></ol>');
  
  // Fix consecutive list items
  html = html.replace(/<\/ul>\s*<ul>/g, '');
  html = html.replace(/<\/ol>\s*<ol>/g, '');
  
  // Convert code blocks
  html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
  
  // Convert inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  return html;
}

// Load a layout file
async function loadLayout(layoutName: string, config: SiteConfig): Promise<string | null> {
  if (!config.layoutDir) return null;
  
  const layoutPath = join(config.layoutDir, `${layoutName}.html`);
  
  try {
    await access(layoutPath);
    const layoutFile = Bun.file(layoutPath);
    return await layoutFile.text();
  } catch (error) {
    console.warn(`Layout file ${layoutPath} not found.`);
    return null;
  }
}

// Apply a layout to content - make sure any custom config variables get passed to templates
async function applyLayout(
  content: string, 
  title: string, 
  config: SiteConfig, 
  layoutName?: string,
  currentPath?: string,
  frontMatter?: FrontMatter
): Promise<string> {
  // Use layout from front matter if specified
  const layoutToUse = frontMatter?.layout || layoutName || config.defaultLayout || 'default';
  
  // Try to load the specified layout or fall back to default
  let layout = await loadLayout(layoutToUse, config);
  
  if (layout) {
    // Calculate relative path to CSS file from current location
    let cssPath = '';
    if (config.cssFile) {
      if (currentPath) {
        // Calculate path depth to create proper relative path
        const depth = currentPath.split('/').filter(Boolean).length;
        cssPath = depth > 0 
          ? '../'.repeat(depth) + basename(config.cssFile)
          : basename(config.cssFile);
      } else {
        cssPath = basename(config.cssFile);
      }
    }
    
    // Fix links in the layout
    if (currentPath) {
      layout = fixLayoutLinks(layout, currentPath);
    }
    
    // Replace standard placeholders
    layout = layout
      .replace(/\{\{\s*content\s*\}\}/g, content)
      .replace(/\{\{\s*title\s*\}\}/g, frontMatter?.title || title)
      .replace(/\{\{\s*css\s*\}\}/g, cssPath ? `<link rel="stylesheet" href="${cssPath}">` : '')
      .replace(/\{\{\s*siteTitle\s*\}\}/g, config.siteTitle || 'My Site')
      .replace(/\{\{\s*year\s*\}\}/g, new Date().getFullYear().toString())
      .replace(/\{\{\s*description\s*\}\}/g, frontMatter?.description || config.siteDescription || '')
      .replace(/\{\{\s*author\s*\}\}/g, frontMatter?.author || config.siteAuthor || '');
    
    // Replace any additional front matter variables
    if (frontMatter) {
      for (const [key, value] of Object.entries(frontMatter)) {
        if (typeof value === 'string') {
          layout = layout.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g'), value);
        } else if (Array.isArray(value)) {
          layout = layout.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g'), value.join(', '));
        }
      }
    }
    
    // Replace any additional config variables
    // This allows for custom variables in templates
    for (const [key, value] of Object.entries(config)) {
      if (typeof value === 'string') {
        layout = layout.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g'), value);
      }
    }
    
    return layout;
  }
  
  // Fall back to basic template if no layout is found
  return wrapWithTemplate(content, frontMatter?.title || title, config.cssFile 
    ? basename(config.cssFile)
    : undefined);
}

// Wrap HTML content with a template - used as fallback when no layout exists
function wrapWithTemplate(content: string, title: string, cssPath?: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  ${cssPath ? `<link rel="stylesheet" href="${cssPath}">` : ''}
</head>
<body>
  <header>
    <nav>
      <ul>
        <li><a href="/">Home</a></li>
      </ul>
    </nav>
  </header>
  <main>
    ${content}
  </main>
  <footer>
    <p>© ${new Date().getFullYear()} - Generated with Bun Static Site Generator</p>
  </footer>
</body>
</html>`;
}

// Format a date string into a more readable format
function formatDate(dateString: string): string {
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  } catch (e) {
    console.warn(`Invalid date format: ${dateString}`);
    return dateString;
  }
}

// Process an individual file
async function processFile(
  filePath: string, 
  config: SiteConfig, 
  isIndex: boolean = false
): Promise<string | null> {
  console.log(`📄 Processing file: ${filePath}`);
  
  const file = Bun.file(filePath);
  const content = await file.text();
  const ext = extname(filePath);
  const relPath = relative(config.contentDir, filePath);
  const fileBasename = basename(filePath, ext);
  
  // We only process markdown files now
  if (ext !== '.md') {
    if (ext !== '.ts' && ext !== '.js') {
      console.log(`📦 Copying asset: ${filePath}`);
      await copyAsset(filePath, config);
    }
    return null;
  }
  
  // Extract front matter and markdown content
  const { frontMatter, content: markdownContent } = extractFrontMatter(content);
  
  // Process markdown file
  console.log(`🔄 Converting markdown to HTML: ${filePath}`);
  const htmlContent = markdownToHtml(markdownContent);
  const outputRelPath = relPath.replace(/\.md$/, '.html');
  
  // Use title from front matter or generate from filename
  const title = frontMatter.title || 
    (fileBasename.charAt(0).toUpperCase() + fileBasename.slice(1));
  
  // Get current relative path for proper link generation
  const currentRelPath = relative(config.contentDir, dirname(filePath));
  
  // Format date for display if present
  if (frontMatter.date) {
    frontMatter.formattedDate = formatDate(frontMatter.date);
  }
  
  // Apply layout
  const finalHtml = await applyLayout(
    htmlContent,
    isIndex ? (config.siteTitle || 'Home') : title,
    config,
    undefined, // Let applyLayout use frontMatter.layout if specified
    currentRelPath,
    frontMatter
  );
  
  const outputPath = join(config.outputDir, outputRelPath);
  await mkdir(dirname(outputPath), { recursive: true });
  await Bun.write(outputPath, finalHtml);
  
  console.log(`✅ Generated HTML: ${outputPath}`);
  
  return outputRelPath;
}

// Copy assets (non-content files)
async function copyAsset(filePath: string, config: SiteConfig): Promise<void> {
  const relPath = relative(config.contentDir, filePath);
  const outputPath = join(config.outputDir, relPath);
  await mkdir(dirname(outputPath), { recursive: true });
  
  const file = Bun.file(filePath);
  await Bun.write(outputPath, file);
}

// Process a directory recursively
async function processDirectory(
  dirPath: string, 
  config: SiteConfig,
  linksForIndex: { path: string; title: string; description?: string; date?: string }[] = [],
  currentDepth: number = 0
): Promise<{ path: string; title: string; description?: string; date?: string }[]> {
  console.log(`📂 Processing directory: ${dirPath}`);
  const entries = await readdir(dirPath, { withFileTypes: true });
  const folderLinks: { path: string; title: string; description?: string; date?: string }[] = [];
  let hasIndex = false;
  
  // Check if directory has an index.md file
  for (const entry of entries) {
    if (entry.isFile() && (entry.name === 'index.md')) {
      hasIndex = true;
      break;
    }
  }
  
  // First process all files in this directory
  for (const entry of entries) {
    if (entry.isFile()) {
      const filePath = join(dirPath, entry.name);
      const ext = extname(filePath);
      
      if (ext === '.md') {
        const isIndex = basename(filePath, ext) === 'index';
        const outputRelPath = await processFile(filePath, config, isIndex);
        
        if (outputRelPath && !isIndex) {
          // Extract front matter to get title, description, and date for links
          const file = Bun.file(filePath);
          const content = await file.text();
          const { frontMatter } = extractFrontMatter(content);
          
          const title = frontMatter.title || 
            basename(filePath, ext).charAt(0).toUpperCase() + basename(filePath, ext).slice(1);
          
          folderLinks.push({ 
            path: outputRelPath, 
            title,
            description: frontMatter.description,
            date: frontMatter.date
          });
          
          // Always add to global links list with proper paths
          linksForIndex.push({ 
            path: outputRelPath, 
            title,
            description: frontMatter.description,
            date: frontMatter.date
          });
        }
      } else if (ext !== '.ts' && ext !== '.js') {
        // Copy other assets except TypeScript/JavaScript files
        await copyAsset(filePath, config);
      }
    }
  }
  
  // Then process all subdirectories
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const subDirPath = join(dirPath, entry.name);
      
      // Pass empty array as localized links for the subdirectory
      const subLocalLinks: { path: string; title: string; description?: string; date?: string }[] = [];
      await processDirectory(subDirPath, config, linksForIndex, currentDepth + 1);
      
      // Add subdirectory link to current folder's links
      const relPath = relative(config.contentDir, subDirPath);
      const htmlPath = `${relPath}/index.html`;
      folderLinks.push({ 
        path: htmlPath, 
        title: entry.name.charAt(0).toUpperCase() + entry.name.slice(1) 
      });
    }
  }
  
  // Generate an index for this directory if needed
  if (!hasIndex && folderLinks.length > 0) {
    await generateFolderIndex(dirPath, folderLinks, config);
  }
  
  return linksForIndex;
}

// Generate an index for a specific folder
async function generateFolderIndex(
  dirPath: string, 
  links: { path: string; title: string; description?: string; date?: string }[], 
  config: SiteConfig
): Promise<void> {
  const relativePath = relative(config.contentDir, dirPath);
  console.log(`📑 Generating index for: ${relativePath || 'root'}`);
  console.log(`   Links to include: ${JSON.stringify(links.map(l => l.path))}`);
  
  const folderName = basename(dirPath);
  const title = folderName.charAt(0).toUpperCase() + folderName.slice(1);
  
  // Sort links by date if available, then alphabetically by title
  links.sort((a, b) => {
    if (a.date && b.date) {
      return new Date(b.date).getTime() - new Date(a.date).getTime(); // Newest first
    }
    return a.title.localeCompare(b.title);
  });
  
  // Generate index content
  let indexContent = `<h1>${title}</h1>\n<div class="post-list">`;
  
  for (const link of links) {
    // Ensure we have proper URL path format with forward slashes
    const linkPath = link.path.replace(/\\/g, '/');
    
    // Make paths relative to current folder
    let adjustedPath;
    if (relativePath) {
      // If we're in a subfolder, calculate the relative path
      if (linkPath.startsWith(relativePath + '/')) {
        // Link points to a file in this directory or subdirectory
        adjustedPath = linkPath.substring((relativePath + '/').length);
      } else {
        // Link points to a file in another directory branch
        // Calculate how many levels up we need to go
        const depth = relativePath.split('/').length;
        adjustedPath = '../'.repeat(depth) + linkPath;
      }
    } else {
      // If we're at the root, just use the path as is
      adjustedPath = linkPath;
    }
    
    console.log(`   Link: ${linkPath} => ${adjustedPath}`);
    
    indexContent += `\n  <div class="post-item">
    <a href="${adjustedPath}" class="post-title">${link.title}</a>`;
    
    if (link.date) {
      indexContent += `\n    <div class="post-date">${formatDate(link.date)}</div>`;
    }
    
    if (link.description) {
      indexContent += `\n    <div class="post-excerpt">${link.description}</div>`;
    }
    
    indexContent += `\n    <a href="${adjustedPath}" class="read-more">Read more</a>
  </div>`;
  }
  
  indexContent += '\n</div>';
  
  // Apply layout to the generated index
  const finalHtml = await applyLayout(
    indexContent,
    title,
    config,
    undefined,
    relativePath,
    { title }
  );
  
  // Write the index file
  const outputPath = join(config.outputDir, relativePath || '.', 'index.html');
  await mkdir(dirname(outputPath), { recursive: true });
  await Bun.write(outputPath, finalHtml);
  
  console.log(`✅ Generated index: ${outputPath}`);
}

// Generate root index if needed
async function generateIndexIfNeeded(config: SiteConfig, links: { path: string; title: string; description?: string; date?: string }[]): Promise<void> {
  const indexPath = join(config.contentDir, 'index.md');
  
  // Check if an index file already exists
  try {
    await stat(indexPath);
    return; // Index exists, don't generate
  } catch (e) {
    // No index exists, generate one
    await generateFolderIndex(config.contentDir, links, config);
  }
}

// Copy CSS file if provided
async function copyCssFile(config: SiteConfig): Promise<void> {
  if (!config.cssFile) return;
  
  try {
    const cssFile = Bun.file(config.cssFile);
    await Bun.write(join(config.outputDir, basename(config.cssFile)), cssFile);
  } catch (error) {
    console.error(`Error copying CSS file: ${error}`);
  }
}

// Main generation function
async function generateSite(config: SiteConfig): Promise<void> {
  console.log(`\n🚀 Generating site from ${config.contentDir} to ${config.outputDir}`);
  console.log(`🔍 Scanning for content files...`);
  
  // Create output directory
  await mkdir(config.outputDir, { recursive: true });
  
  // Copy CSS if provided
  if (config.cssFile) {
    console.log(`🎨 Copying CSS file: ${config.cssFile}`);
    await copyCssFile(config);
  }
  
  // Process all content
  const links = await processDirectory(config.contentDir, config);
  console.log(`📋 Found ${links.length} content files to link to`);
  
  // Generate root index if needed
  await generateIndexIfNeeded(config, links);
  
  console.log(`\n✅ Site generated successfully in ${config.outputDir}`);
}

// Function to determine content type based on file extension
function getContentType(path: string): string {
  const ext = extname(path).toLowerCase();
  const contentTypes: Record<string, string> = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
  };
  
  return contentTypes[ext] || 'application/octet-stream';
}


// Fix navbar links to be proper relative links
function fixLayoutLinks(layout: string, relativePath: string): string {
  // If we're at site root, don't change anything
  if (!relativePath) {
    return layout;
  }
  
  // Calculate path depth
  const depth = relativePath.split('/').filter(Boolean).length;
  const prefix = depth > 0 ? '../'.repeat(depth) : '';
  
  return layout
    // Fix links that start with '/'
    .replace(/href="\/([^"]*)"/g, (match, p1) => {
      // Don't change links that are just '/'
      if (p1 === '') return `href="${prefix}"`;
      // Don't add path prefix to absolute URLs (those with protocol)
      if (p1.match(/^(http|https|mailto|ftp|tel):/)) return match;
      return `href="${prefix}${p1}"`;
    });
}

// Watch for changes and rebuild on save when in serve mode

async function main() {
  const args = Bun.argv.slice(2);
  
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
Bun Static Site Generator

Usage:
  bun run index.ts [options]

Options:
  --content <dir>   Directory containing content files (default: ${DEFAULT_CONFIG.contentDir})
  --output <dir>    Output directory for the generated site (default: ${DEFAULT_CONFIG.outputDir})
  --layouts <dir>   Directory containing layout templates (default: ${DEFAULT_CONFIG.layoutDir})
  --layout <name>   Default layout to use (default: ${DEFAULT_CONFIG.defaultLayout})
  --css <file>      Path to a CSS file to include (default: ${DEFAULT_CONFIG.cssFile || 'none'})
  --title <string>  Site title (default: "${DEFAULT_CONFIG.siteTitle}")
  --serve           Start a development server after building (default: ${DEFAULT_CONFIG.serve ? 'yes' : 'no'})
  --port <number>   Port to use for development server (default: ${DEFAULT_CONFIG.port})
  -h, --help        Show this help message

To change default settings, edit the DEFAULT_CONFIG object at the top of index.ts
`);
    return;
  }
  
  // Start with the default config and override with command line args
  const config: SiteConfig = { ...DEFAULT_CONFIG };
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--content' && i + 1 < args.length) {
      config.contentDir = args[++i];
    } else if (args[i] === '--output' && i + 1 < args.length) {
      config.outputDir = args[++i];
    } else if (args[i] === '--layouts' && i + 1 < args.length) {
      config.layoutDir = args[++i];
    } else if (args[i] === '--layout' && i + 1 < args.length) {
      config.defaultLayout = args[++i];
    } else if (args[i] === '--css' && i + 1 < args.length) {
      config.cssFile = args[++i];
    } else if (args[i] === '--title' && i + 1 < args.length) {
      config.siteTitle = args[++i];
    } else if (args[i] === '--serve') {
      config.serve = true;
    } else if (args[i] === '--no-serve') {
      config.serve = false;
    } else if (args[i] === '--port' && i + 1 < args.length) {
      config.port = parseInt(args[++i], 10);
    }
  }
  
  await generateSite(config);
}

// Execute main function if this is the entry point
if (import.meta.path === Bun.main) {
  main().catch(error => {
    console.error('Error:', error);
    process.exit(1);
  });
}

export { generateSite };
