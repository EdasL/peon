# Contributing to peon.work

Thanks for your interest in contributing! This guide will help you get started.

## 🚀 Getting Started

1. **Fork the repository** on GitHub
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/your-username/peon.git
   cd peon
   ```
3. **Install dependencies**:
   ```bash
   npm install
   ```
4. **Start development environment**:
   ```bash
   npm run dev
   ```

## 📂 Project Structure

- `packages/core/` - Shared types and utilities
- `packages/gateway/` - Backend API and server
- `packages/web/` - React frontend application  
- `packages/worker/` - OpenClaw AI agent workers
- `docs/` - Documentation and planning files
- `docker/` - Docker development environment

## 🔧 Development Workflow

1. **Create a feature branch**:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes** and test locally:
   ```bash
   npm run typecheck  # Check TypeScript
   npm run build      # Test builds
   ```

3. **Commit your changes**:
   ```bash
   git add .
   git commit -m "feat: add your feature description"
   ```

4. **Push and create a PR**:
   ```bash
   git push origin feature/your-feature-name
   ```

## 📝 Commit Convention

We use conventional commits:

- `feat:` - New features
- `fix:` - Bug fixes
- `docs:` - Documentation changes
- `style:` - Code style changes
- `refactor:` - Code refactoring
- `test:` - Adding tests
- `chore:` - Maintenance tasks

## 🐛 Reporting Issues

When reporting issues, please include:

- **Description** of the problem
- **Steps to reproduce**
- **Expected behavior**
- **Actual behavior**
- **Environment details** (OS, Node.js version, etc.)

## 💡 Feature Requests

Have an idea? We'd love to hear it! Please:

1. **Check existing issues** first
2. **Create a new issue** with the "enhancement" label
3. **Describe the feature** and why it would be useful
4. **Include mockups** or examples if helpful

## 🏗️ Architecture Guidelines

- **Frontend**: Use React hooks and functional components
- **Backend**: Follow Hono patterns for API routes
- **Database**: Use Drizzle ORM for all database operations
- **Types**: Define TypeScript interfaces in `packages/core`
- **Styling**: Use Tailwind CSS classes

## 🧪 Testing

Currently setting up testing infrastructure. For now:

- Test manually with the development environment
- Verify TypeScript compilation with `npm run typecheck`
- Test all critical user paths before submitting PRs

## 📚 Resources

- [Architecture Overview](docs/architecture-overview.md)
- [Sprint Plans](docs/plans/)
- [Hono Documentation](https://hono.dev/)
- [React Documentation](https://react.dev/)

## ❓ Questions?

Feel free to:
- Open an issue for discussion
- Join our community channels (coming soon)
- Reach out to maintainers

---

Happy coding! 🎉