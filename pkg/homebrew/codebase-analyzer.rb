# frozen_string_literal: true

# =============================================================================
# Homebrew Formula: codebase-analyzer
# =============================================================================
#
# Install via a custom tap:
#
#   1. Create a GitHub repo named "homebrew-tap" under your account.
#   2. Copy this file into that repo as Formula/codebase-analyzer.rb
#   3. Users can then install with:
#
#        brew tap adityawrk/tap
#        brew install codebase-analyzer
#
#   Or in one command:
#
#        brew install adityawrk/tap/codebase-analyzer
#
# Release workflow:
#
#   1. Run scripts/build-release.sh to produce tarballs for each platform.
#   2. Create a GitHub release tagged vX.Y.Z and upload the tarballs.
#   3. Compute sha256 for each tarball:
#        shasum -a 256 codebase-analyzer-darwin-arm64.tar.gz
#        shasum -a 256 codebase-analyzer-darwin-x86_64.tar.gz
#   4. Update the sha256 values and version in this formula.
#   5. Push the updated formula to your homebrew-tap repo.
#
# =============================================================================

class CodebaseAnalyzer < Formula
  desc "Self-hosted static analysis CLI that produces codebase reports without LLM dependency"
  homepage "https://github.com/adityawrk/codebase-analyzer"
  version "0.1.0"
  license "MIT"

  # ── Platform-specific binaries ──────────────────────────────────────
  #
  # Each release tarball contains:
  #   codebase-analyzer          (the compiled bun binary)
  #   wasm/tree-sitter.wasm      (web-tree-sitter runtime)
  #   wasm/tree-sitter-*.wasm    (per-language grammar files)
  #
  # The tarball is produced by scripts/build-release.sh.

  on_macos do
    on_arm do
      url "https://github.com/adityawrk/codebase-analyzer/releases/download/v#{version}/codebase-analyzer-darwin-arm64.tar.gz"
      sha256 "PLACEHOLDER_SHA256_DARWIN_ARM64"
    end

    on_intel do
      url "https://github.com/adityawrk/codebase-analyzer/releases/download/v#{version}/codebase-analyzer-darwin-x86_64.tar.gz"
      sha256 "PLACEHOLDER_SHA256_DARWIN_X86_64"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/adityawrk/codebase-analyzer/releases/download/v#{version}/codebase-analyzer-linux-arm64.tar.gz"
      sha256 "PLACEHOLDER_SHA256_LINUX_ARM64"
    end

    on_intel do
      url "https://github.com/adityawrk/codebase-analyzer/releases/download/v#{version}/codebase-analyzer-linux-x86_64.tar.gz"
      sha256 "PLACEHOLDER_SHA256_LINUX_X86_64"
    end
  end

  # ── Dependencies ────────────────────────────────────────────────────
  #
  # scc: Lines-of-code counter used by the sizing analyzer.
  #   https://github.com/boyter/scc — available in homebrew-core.
  #
  # gitleaks: Secret detection scanner used by the security analyzer.
  #   https://github.com/gitleaks/gitleaks — available in homebrew-core.
  #
  # NOTE: jscpd (copy-paste / duplication detector) is an npm package and
  # is NOT available in Homebrew. Users must install it separately:
  #
  #   npm install -g jscpd
  #
  # If jscpd is not found, codebase-analyzer degrades gracefully — the
  # duplication analyzer will report status: "skipped" with a reason.

  depends_on "scc"
  depends_on "gitleaks"

  def install
    # ── Strategy ──────────────────────────────────────────────────────
    #
    # The binary is a self-contained bun-compiled executable. However,
    # tree-sitter WASM files (runtime + grammars) cannot be embedded in
    # the binary and must be loadable at runtime.
    #
    # We install the binary and WASM files to libexec, then create a
    # thin wrapper script in bin that sets CODEBASE_ANALYZER_WASM_DIR
    # so the binary knows where to find the WASM files.
    #
    # Installation layout:
    #   #{libexec}/codebase-analyzer                (the real binary)
    #   #{libexec}/wasm/tree-sitter.wasm            (runtime)
    #   #{libexec}/wasm/tree-sitter-typescript.wasm  (grammar)
    #   #{libexec}/wasm/tree-sitter-tsx.wasm         (grammar)
    #   #{libexec}/wasm/tree-sitter-javascript.wasm  (grammar)
    #   #{libexec}/wasm/tree-sitter-python.wasm      (grammar)
    #   #{libexec}/wasm/tree-sitter-go.wasm          (grammar)
    #   #{bin}/codebase-analyzer                     (wrapper script)

    # Install binary to libexec (not directly to bin)
    libexec.install "codebase-analyzer"

    # Install WASM files alongside the binary in libexec/wasm/
    (libexec/"wasm").install Dir["wasm/*.wasm"]

    # Create a wrapper script in bin that sets the WASM path and
    # delegates to the real binary. This is the standard Homebrew
    # pattern for binaries that need sibling files.
    (bin/"codebase-analyzer").write <<~BASH
      #!/usr/bin/env bash
      # Homebrew wrapper for codebase-analyzer.
      # Sets WASM directory so tree-sitter grammars are discoverable.
      export CODEBASE_ANALYZER_WASM_DIR="#{libexec}/wasm"
      exec "#{libexec}/codebase-analyzer" "$@"
    BASH
  end

  def caveats
    <<~EOS
      codebase-analyzer requires jscpd for duplication detection.
      jscpd is not available via Homebrew — install it with npm:

        npm install -g jscpd

      If jscpd is not installed, the duplication analyzer will be skipped
      and the report will note it as status: "skipped".

      External tool dependencies installed by this formula:
        - scc (lines-of-code counting)
        - gitleaks (secret detection)
    EOS
  end

  test do
    # Verify the binary runs and reports its version.
    assert_match version.to_s, shell_output("#{bin}/codebase-analyzer --version")

    # Verify the wrapper script exists and is executable.
    assert_predicate bin/"codebase-analyzer", :executable?

    # Verify WASM files were installed.
    assert_predicate libexec/"wasm/tree-sitter.wasm", :exist?

    # Verify the binary can at least start without crashing on a
    # non-existent path (should exit 1 with an error message).
    output = shell_output("#{bin}/codebase-analyzer analyze /nonexistent 2>&1", 1)
    assert_match(/does not exist/i, output)
  end
end
