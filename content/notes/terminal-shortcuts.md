# Terminal Shortcuts I Use Daily

<div class="post-date">May 10, 2024</div>

Bash/Zsh shortcuts that save me time every day:

## Navigation
- `Ctrl+A` - Move cursor to beginning of line
- `Ctrl+E` - Move cursor to end of line
- `Alt+B` - Move back one word
- `Alt+F` - Move forward one word
- `Ctrl+U` - Cut everything before the cursor
- `Ctrl+K` - Cut everything after the cursor
- `Ctrl+W` - Cut the word before the cursor
- `Ctrl+Y` - Paste the last cut text

## History
- `Ctrl+R` - Search command history
- `!!` - Repeat the last command
- `!$` - Repeat the last argument of the previous command
- `!foo` - Run the most recent command that starts with 'foo'

## File Operations
- `mkdir -p path/to/nested/dir` - Create nested directories
- `cp -r dir1 dir2` - Copy directories recursively
- `find . -name "*.js" | xargs grep "function"` - Find text in files

## Process Management
- `Ctrl+C` - Kill the current process
- `Ctrl+Z` - Suspend the current process
- `fg` - Resume the most recently suspended process
- `jobs` - List all suspended processes 