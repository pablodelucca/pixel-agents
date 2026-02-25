# Cross-Platform Support

## Platform Compatibility

### ✅ **macOS** - Fully Supported & Tested
- **Status**: ✅ Tested and working
- **Copilot CLI**: Officially supported
- **Claude Code**: Officially supported
- **File watching**: Native `fs.watch()` works reliably
- **Paths**: Uses `os.homedir()` and `path.join()` correctly
- **Tested on**: macOS 14+ (current development environment)

### ⚠️ **Windows** - Should Work (Needs Testing)
- **Status**: ⚠️ Not tested but should work
- **Copilot CLI**: Supported via WSL (Windows Subsystem for Linux)
- **Claude Code**: Supported
- **File watching**: `fs.watch()` known to be less reliable, but we have 2s polling backup
- **Paths**: Code uses `path.join()` and normalizes separators correctly
- **Original extension**: Only tested on Windows 11 by original author
- **Recommendation**: Test on Windows 10/11 with native terminals and WSL

### ✅ **Linux/Ubuntu** - Should Work (Needs Testing)  
- **Status**: ✅ Should work (standard Node.js environment)
- **Copilot CLI**: Officially supported
- **Claude Code**: Officially supported
- **File watching**: `fs.watch()` works well on Linux
- **Paths**: Uses standard POSIX paths via Node.js APIs
- **Recommendation**: Test on Ubuntu 22.04/24.04

## Implementation Details

### Path Handling ✅
All path operations use cross-platform Node.js APIs:
- ✅ `path.join()` for constructing paths
- ✅ `os.homedir()` for home directory
- ✅ `path.sep` for platform-specific separators
- ✅ Path normalization in `inferAgentTypeFromPath()`
- ❌ No hardcoded `/` or `\` in path construction

### File Watching ✅
Hybrid approach for reliability:
- **Primary**: `fs.watch()` (native, platform-specific)
- **Backup**: 2-second polling (works everywhere)
- **Tested on**: macOS (primary development platform)
- **Known issue**: `fs.watch()` less reliable on Windows → polling backup handles this

### Home Directory Paths ✅
- **macOS**: `~/.copilot/`, `~/.claude/`
- **Linux**: `~/.copilot/`, `~/.claude/`
- **Windows**: `C:\Users\<username>\.copilot\`, `C:\Users\<username>\.claude\`
- **Implementation**: Uses `os.homedir()` (cross-platform)

### Copilot CLI Requirements
According to official documentation:
- **macOS**: ✅ Native support
- **Linux**: ✅ Native support
- **Windows**: ✅ Via WSL (Windows Subsystem for Linux)

### Claude Code CLI Requirements
According to official documentation:
- **macOS**: ✅ Native support
- **Linux**: ✅ Native support
- **Windows**: ✅ Native support

## Testing Checklist

### For Windows Testing:
- [ ] Install extension in VS Code on Windows
- [ ] Test with native Windows terminals
- [ ] Test with WSL terminals
- [ ] Create agent and verify character appears
- [ ] Run commands and verify animations
- [ ] Test turn completion (waiting bubble)
- [ ] Test terminal adoption
- [ ] Test session restoration after reload

### For Linux/Ubuntu Testing:
- [ ] Install extension in VS Code on Ubuntu
- [ ] Create agent and verify character appears
- [ ] Run commands and verify animations
- [ ] Test turn completion (waiting bubble)
- [ ] Test terminal adoption
- [ ] Test session restoration after reload

## Known Platform-Specific Issues

### macOS (Current Platform)
- ✅ No known issues
- ✅ File watching works reliably
- ✅ All features tested and working

### Windows (From Original README)
- ⚠️ Original author only tested on Windows 11
- ⚠️ `fs.watch()` may be less reliable → polling backup handles this
- ⚠️ Path separators handled correctly via `path.join()`
- ℹ️ Copilot CLI requires WSL

### Linux
- ✅ Should work without issues
- ✅ Standard Node.js environment
- ✅ `fs.watch()` reliable on Linux

## Recommendations

1. **For Production Use**:
   - macOS: ✅ Ready to use
   - Linux: ✅ Should work (test first)
   - Windows: ⚠️ Test with WSL for Copilot CLI

2. **For Development**:
   - All platforms supported via VS Code
   - Extension Development Host works on all platforms
   - Build process (npm, esbuild, vite) is cross-platform

3. **For Users**:
   - macOS users: Works out of the box
   - Linux users: Should work out of the box
   - Windows users: Use WSL for Copilot CLI, native for Claude Code

## Future Work

- [ ] Test on Windows 10/11 (native + WSL)
- [ ] Test on Ubuntu 22.04/24.04
- [ ] Add platform-specific documentation for WSL setup
- [ ] Add automated testing on all platforms (CI/CD)
