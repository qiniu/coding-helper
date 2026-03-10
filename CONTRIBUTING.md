# Contributing to qiniu-coding-helper

Thank you for your interest in contributing! Here's how to get started.

## Development Setup

```bash
# Clone the repository
git clone https://github.com/krisxia0506/qiniu-coding-helper.git
cd qiniu-coding-helper

# Install dependencies (requires pnpm)
pnpm install

# Build the project
pnpm build

# Run in watch mode during development
pnpm dev

# Test locally
node dist/cli.js --version
node dist/cli.js --help
node dist/cli.js doctor
```

## Code Conventions

- **Module system**: ESM (`"type": "module"`), imports must use `.js` suffix
- **TypeScript**: Strict mode, target ES2022, module Node16
- **Naming**:
  - Singletons: camelCase (`configManager`, `modelService`)
  - Classes: PascalCase (`ConfigManager`, `ClaudeCodeTool`)
  - Interfaces: `I` prefix (`ITool`, `IToolManager`)
  - Constants: UPPER_SNAKE_CASE

## Project Structure

```
src/
├── cli.ts                  # CLI entry point
├── commands/               # CLI command handlers
├── lib/
│   ├── config.ts           # Config manager singleton
│   ├── i18n.ts             # Internationalization
│   ├── endpoints.ts        # API endpoint definitions
│   ├── model-service.ts    # Model fetching service
│   ├── tools/              # Tool implementations (ITool interface)
│   └── wizard/             # Interactive wizard system
│       ├── flows/          # Configuration flows
│       ├── menus/          # Menu interactions
│       └── ui/             # Terminal UI helpers
├── locales/                # Translation files (en_US, zh_CN)
└── utils/                  # Shared utilities
```

## Pull Request Process

1. Fork the repository and create a feature branch
2. Make your changes following the code conventions above
3. Ensure `pnpm build` succeeds without errors
4. Verify basic functionality: `node dist/cli.js --version`
5. Submit a pull request with a clear description of your changes

## Adding a New Tool

To add support for a new AI coding assistant:

1. Create a new class implementing `ITool` in `src/lib/tools/`
2. Register it in `src/lib/tool-manager.ts`
3. The tool will automatically appear in the wizard menus

## Adding Translations

Translation files are in `src/locales/`. To add or modify translations:

1. Add keys to both `en_US.json` and `zh_CN.json`
2. Use `t('key_name')` or `t('key_name', { param: value })` in code
3. Rebuild to copy locales to dist: `pnpm build`

## Reporting Issues

Please use [GitHub Issues](https://github.com/krisxia0506/qiniu-coding-helper/issues) to report bugs or request features.
