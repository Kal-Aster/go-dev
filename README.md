# `go-dev`

A simple and robust orchestrator for streamlining local development environments in monorepos.

**`npx go-dev <preset>` – Go develop!**

## 🚀 Introduction

In complex monorepos, starting your development environment can be a chore. You might need to spin up Docker containers, run multiple Node.js (or other language) development servers, handle pre-builds, and manage inter-service dependencies. `go-dev` simplifies this by allowing you to define your entire local development stack in a single YAML configuration file.

`go-dev` acts as a central command to bring up your `api`, `frontend`, `database`, and any other microservices, ensuring they start in the correct order, with the right modes, and provide clear, prefixed logs.

## ✨ Features

*   **Unified Configuration:** Define all your services, their modes (e.g., `dev`, `docker`, `serve`), and dependencies in a single `go-dev.yml` file.
*   **Service Types:**
    *   **`cmd` services:** Run any command-line process (e.g., `npm run dev`, `rollup -w`, `python app.py`). Supports `preCommands` for setup tasks like builds, and `readyWhen` to hold back dependents until the service is actually usable (log match, file, or open port). Commands can be defined in multiple flexible ways to run single or multiple processes in parallel for a service.
    *   **`docker` services:** Manage Docker containers via `docker compose`. Automatically checks container status and performs health checks.
*   **Mode-Aware Dependencies:** Services can depend on other services running in specific modes (e.g., your `api` dev mode might depend on `frontend` in `serve` mode).
*   **Preset-Driven Startup:** Define different "presets" (e.g., `api`, `frontend`, `all`) to easily spin up specific combinations of services tailored to your current development focus.
*   **Interactive Selection (no preset required):** Run `go-dev` with no preset to open a full-screen TUI where you can pick a preset *or* compose a custom selection — toggle services and choose a mode per service — and optionally save that selection as a new preset. Presets become a convenience, not a requirement.
*   **Automatic Dependency Resolution:** `go-dev` builds an intelligent execution graph, starting services in the correct topological order.
*   **Centralized Logging:** Prefixes logs from each service, making it easy to follow activity from multiple concurrent processes.
*   **Automatic Process Exit:** The `go-dev` process will automatically exit when all primary services (those directly listed in the chosen preset) exit cleanly (with a success code of `0`).
*   **Precise Docker Cleanup:** `go-dev` intelligently tracks which Docker Compose services it **actively started** (i.e., those that were not already running). During cleanup, it will only stop these specific services, leaving any pre-existing containers untouched.
*   **Robust Cleanup:** Handles graceful shutdown of all started processes and Docker services on exit (e.g., via `Ctrl+C` or automatic exit).

## 🤔 Why `go-dev`?

While tools like `concurrently` manage parallel processes and `docker compose` handles containers, `go-dev` fills a crucial gap by:

*   **Integrating `cmd` and `docker` services seamlessly:** It bridges the world of host-based processes and containerized applications under one roof.
*   **Providing intelligent mode-aware dependency resolution:** It understands that "frontend" might mean a different set of commands (and dependencies) when you're actively developing the frontend vs. when it's just a dependency for API development.
*   **Offering a single, declarative interface for your entire dev stack:** No more remembering multiple `npm` scripts or `docker compose` commands.

## 📦 Installation

`go-dev` is distributed via npm and designed to be used with `npx`.

```bash
# Install it as a devDependency in your monorepo's root
npm install --save-dev go-dev
# or
yarn add --dev go-dev
```

## 🚀 Usage

Once installed, simply run `go-dev` with the name of the preset you want to start:

```bash
npx go-dev [preset_name] [-c|--config <path>] [-i|--interactive]
```

*   `[preset_name]`: (Optional) The name of the preset defined in your `go-dev.yml` (e.g., `api`, `frontend`, `all`). When omitted, `go-dev` opens the interactive selector (see below).
*   `-c <path>` / `--config <path>` (also `-c=<path>` / `--config=<path>`): (Optional) Path to your `go-dev.yml` file. When omitted, `go-dev` auto-discovers a config file in the current directory (see the **Configuration** section below for the lookup order). The flag must appear before any `--args-for` block.
*   `-i` / `--interactive`: (Optional) Force the interactive selector even when a preset is given, pre-populating it from that preset so you can tweak the selection before starting.

### Interactive selection

Running `go-dev` **without a preset** (in an interactive terminal) opens a full-screen TUI with two tabs:

*   **Services & Modes** — toggle services with <kbd>Space</kbd>, cycle the mode of a hybrid service with <kbd>m</kbd>, then press <kbd>Enter</kbd>. You'll be offered to save the selection as a new preset (written back to your config, preserving comments).
*   **Presets** — pick an existing preset and press <kbd>Enter</kbd> to start it.

A panel at the bottom shows the **resolved selection** split into sections — *primary services* and *dependencies* (each with its mode) — so you can see exactly what will start. On the **Services & Modes** tab it reflects the services you've checked; on the **Presets** tab, the highlighted preset.

If the same service is pulled in under **two different modes** (e.g. `keplero:build` as a primary while another service depends on `keplero:dev`), the panel flags a *mode conflict*: go-dev runs one instance per service, so the losing mode is dropped and that dependency goes unmet. The same warning is printed at startup, so it's visible even when launching a preset by name without the TUI.

Navigate tabs with <kbd>←</kbd>/<kbd>→</kbd>, move with <kbd>↑</kbd>/<kbd>↓</kbd>, and quit with <kbd>q</kbd>. When stdin is not a TTY (e.g. CI) and no preset is given, `go-dev` exits with an error instead of opening the TUI.

The selector **remembers your last launched selection per config file** and restores it the next time you open it. This state is stored in your user state directory (`$XDG_STATE_HOME/go-dev/` on Linux/macOS, `%LOCALAPPDATA%\go-dev\` on Windows), keyed by the config file's canonical absolute path — **never written into your repo**.

**Passing Arguments to Service Commands:**

To pass additional arguments from the command line to a specific service command, use a keyword flag followed by the target and its arguments.

By default, the keyword flag is `--args-for`. This can be customized in your `go-dev.yml` using the `serviceArgsKeyword` option (e.g., `serviceArgsKeyword: pass-to`).

The target for arguments is specified as `<service_name>[:<command_index>]`:

Specify the target for arguments as `<service_name>:<command_index>` (e.g., `api:0`, `frontend:1`). The `command_index` is 0-based and refers to the position of the command within a service's `commands` array. If the `:<command_index>` part is omitted (e.g., just `<service_name>`), arguments are passed to the **first command (index `0`)** defined for that service.

You can combine multiple keyword flag blocks for different services or specific commands.

```bash
npx go-dev <preset_name> [--<serviceArgsKeyword> <service_name>[:<command_index>] [args...] ] [...]
```

**How Arguments are Applied to `cmd` Service Commands:**

When arguments are passed to a `cmd` type service command, `go-dev` processes them in a special way:

1.  **Placeholder Substitution:**
    *   The command array (e.g., `[npx, tsx, ./src/$arg.ts]`) is scanned for the special placeholder `$arg`.
    *   Each occurrence of `$arg` is replaced, in order, by an argument from the `[args...]` provided on the command line.
    *   Example: A command `[npx, tsx, ./src/$arg.ts]` with extra arguments `[index, -w]` will become `[npx, tsx, ./src/index.ts, -w]`.

2.  **Escaped Placeholders:**
    *   If you need a literal `$arg` in your command that should *not* be substituted, escape it with a backslash: `\$arg`.
    *   Example: A command `[echo, \$arg]` with no extra arguments will result in `[echo, $arg]`.

3.  **Remaining Arguments:**
    *   Any arguments from `[args...]` that were *not* used to substitute an `$arg` placeholder will be **appended** to the end of the command array.
    *   Example: A command `[echo, $arg, fixed]` with extra arguments `[first, second, third]` will become `[echo, first, fixed, second, third]`. Here, `first` replaces `$arg`, and `second`, `third` are appended.

**Full Example:**

Consider an `api` service with two parallel commands: `api:0` (main server, using `$arg`) and `api:1` (TypeScript compiler watch).

```bash
npx go-dev all \
  --args-for api:0 main-entrypoint --host 0.0.0.0 --port 8081 \
  --args-for api:1 --pretty --diagnostics \
  --args-for frontend --log-level verbose
```
*In the example above, `--args-for frontend` is equivalent to `--args-for frontend:0`.*

Press `Ctrl+C` at any time to gracefully shut down all running services. `go-dev` will also automatically exit once all primary services (those directly listed in your chosen preset) have completed their execution cleanly.

## ⚙️ Configuration (`go-dev.yml`)

Create a configuration file in your project's root.

By default, `go-dev` automatically detects its configuration file. It looks for files named `go-dev` (or `.go-dev` for a hidden file), optionally including `.config` before the `.yml` or `.yaml` extension. It will search for these files in the directory where you run `npx go-dev`.

Common examples include: `go-dev.yml`, `.go-dev.yml`, and `go-dev.config.yaml`.

```yaml
# go-dev.yml

# Customize the keyword used to pass arguments to service commands from the CLI.
# Change this if 'args-for' conflicts with a command your services use.
serviceArgsKeyword: args-for # Default value

# Define your individual services here
services:
  # Example: A Docker-based PostgreSQL database
  postgres:
    type: docker         # This service runs inside Docker
    service: postgres    # Name of the service in your docker-compose.yml
    composeFile: infrastructure/docker-compose.yml # Path to the docker-compose file
    healthCheck: true    # Enable health checks for this Docker service

  # Example: Your API service, which can run in 'dev' (cmd) or 'docker' mode
  api:
    type: hybrid         # This service has multiple modes
    defaultMode: dev     # Default mode if not specified by a preset or dependency
    # Note: The name of the modes is totally arbitrary
    modes:
      # API in active development mode (runs directly on host)
      dev:
        type: cmd             # This mode runs a command-line process
        # The 'commands' property can be specified in three ways:
        # 1. As a simple array of strings (for a single command without extra options)
        #    commands: [npx, rollup, -c, -w]
        # 2. As a single command object (for one command with options like 'directory' or 'restartOnError')
        #    commands:
        #      command: [npx, rollup, -c, -w]
        #      directory: ./api
        #      restartOnError: true # Default is true for 'cmd' services
        # 3. As an array of command objects (for multiple parallel commands)
        commands:
          - command: [npx, rollup, -c, -w] # The primary command for development (index 0)
            directory: ./api      # Directory to run the command from
            # restartOnError: true # (Optional, defaults to true)
          # Example of a second parallel command for API (index 1)
          # - command: [npx, tsc, --watch]
          #   directory: ./api
        dependencies:         # What this mode depends on
          - postgres          # API dev needs PostgreSQL (will use postgres's default docker mode)
          - { service: frontend, mode: serve } # API dev needs frontend running in its 'serve' mode

      # API running as a Docker container (e.g., for frontend-only dev)
      docker:
        type: docker
        service: api
        composeFile: infrastructure/docker-compose.yml
        healthCheck: true
        dependencies:
          - postgres # Docker API also needs PostgreSQL

  # Example: Your Frontend service, which can run in 'dev' (cmd) or 'serve' (cmd) mode
  frontend:
    type: hybrid
    defaultMode: dev
    modes:
      # Frontend in active development (watch mode)
      dev:
        type: cmd
        commands:
          command: [npx, rollup, -c, -w]
          directory: ./frontend
        # 'readyWhen' holds back dependents until this (long-running) service is
        # actually usable, instead of resolving as soon as the process spawns.
        # This is the watch-mode counterpart of docker's 'healthCheck': prefer it
        # over building shared artifacts again as a preCommand of every consumer.
        # Provide at least one condition (multiple are combined with AND):
        #   logMatch: "<regex>"   — ready when a line on stdout/stderr matches
        #   file: ./dist/index.js — ready when the path exists on disk
        #   port: 5173            — ready when a TCP connection succeeds
        # Optional: host (default 127.0.0.1), timeoutMs (60000), pollIntervalMs (500).
        readyWhen:
          logMatch: "created .* in"   # rollup's "created dist/... in 1.2s"
        dependencies:
          # Frontend dev needs API (will use api's default docker mode for this preset)
          # Note: No direct circular dependency between dev modes.
          # Dev modes often assume peers will eventually be ready.
          - { service: api, mode: docker } 

      # Frontend serving its built assets (e.g., when API depends on it)
      serve:
        type: cmd
        # 'preCommands' run and complete BEFORE the main command starts.
        # Each entry can be one of:
        #   1. An array of strings — a literal command, run synchronously.
        #        - [npm, --prefix, frontend, run, build]
        #   2. An object — a literal command with options.
        #        - { command: [npm, run, build], directory: ./frontend }
        #   3. An object referencing another service+mode — runs that service to
        #      completion (its own preCommands recurse; parallel commands run in
        #      parallel and are all awaited). The target must be a `cmd`-type
        #      mode. If multiple services reference the same `service:mode`
        #      within a single `go-dev` invocation, it runs only ONCE and other
        #      referrers await the same result.
        #        - { service: main, mode: build }
        preCommands:
          - [npm, --prefix, frontend, run, build]
        commands:
          command: [node, ./localserver.mjs] # Then start the local server
          directory: ./frontend
        dependencies:
          - api # Frontend serve needs API (will use api's default dev mode for this preset)


# Define different development presets (combinations of services and their modes)
presets:
  # Preset: "api" development focus
  # Starts API in dev mode, pulling in its dependencies (postgres, frontend:serve)
  api:
    services: [api] # Only explicitly list top-level services you want to run
    modes:
      # no explicit modes needed here, as defaultMode and dependency requests handle it
      # api: dev # (already default)
      # frontend: serve # (requested by api:dev)
      # postgres: dev # (pulled by dependencies)

  # Preset: "frontend" development focus
  # Starts Frontend in dev mode, pulling in its dependencies (api:docker, postgres)
  frontend:
    services: [frontend]
    modes:
      # frontend: dev # (already default)
      # api: docker # (requested by frontend:dev)
      # postgres: dev # (pulled by dependencies)

  # Preset: "all" development (both API and Frontend in dev mode concurrently)
  all:
    services: [api, frontend] # Explicitly list both as top-level focus
    modes:
      # api: dev # (already default)
      # frontend: dev # (already default)
      # No need to specify modes if they match the defaultMode
```

## 🤝 Contributing

Contributions are welcome! Feel free to open issues or submit pull requests.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.