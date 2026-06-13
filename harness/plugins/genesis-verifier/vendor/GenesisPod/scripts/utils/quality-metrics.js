#!/usr/bin/env node
/**
 * Quality Metrics Script
 *
 * Provides quantifiable quality verification metrics:
 * 1. Count `any` types in backend and frontend production code
 * 2. Run TypeScript type checking
 * 3. Check ESLint error count
 *
 * Outputs both JSON and human-readable summary.
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const BACKEND_SRC = path.join(process.cwd(), "backend", "src");
const FRONTEND_SRC = path.join(process.cwd(), "frontend");

/**
 * Execute command and return output, or null if failed
 */
function execCommand(command, options = {}) {
  try {
    return execSync(command, {
      encoding: "utf8",
      stdio: options.silent ? "pipe" : "inherit",
      cwd: options.cwd || process.cwd(),
      ...options,
    });
  } catch (error) {
    if (options.returnError) {
      return {
        error: true,
        code: error.status,
        output: error.stdout || error.stderr || "",
      };
    }
    return null;
  }
}

/**
 * Count `any` types in TypeScript files
 * Excludes test files (*.spec.ts, *.test.ts), node_modules, dist, .next
 */
function countAnyTypes(directory, excludePatterns = []) {
  const defaultExcludes = [
    "node_modules",
    "dist",
    ".next",
    "*.spec.ts",
    "*.test.ts",
  ];
  const allExcludes = [...defaultExcludes, ...excludePatterns];

  try {
    // Use grep to find all occurrences of ': any' in TypeScript files
    const grepPattern = ": any";
    let findArgs = `"${directory}" -type f \\( -name "*.ts" -o -name "*.tsx" \\)`;

    // Add exclude patterns
    allExcludes.forEach((pattern) => {
      if (pattern.includes("*")) {
        findArgs += ` ! -name "${pattern}"`;
      } else {
        findArgs += ` ! -path "*/${pattern}/*"`;
      }
    });

    const command =
      process.platform === "win32"
        ? `powershell -Command "Get-ChildItem -Path '${directory}' -Recurse -Include *.ts,*.tsx | Where-Object { $_.FullName -notmatch 'node_modules|dist|\\\\.next|spec\\\\.ts|test\\\\.ts' } | Select-String -Pattern ': any' | Measure-Object | Select-Object -ExpandProperty Count"`
        : `find ${findArgs} -exec grep -o "${grepPattern}" {} \\; | wc -l`;

    const output = execCommand(command, { silent: true, returnError: false });

    if (output === null) {
      // Try alternative method: manually count files
      return countAnyTypesManual(directory, allExcludes);
    }

    return parseInt(output.trim()) || 0;
  } catch (error) {
    console.error(`Error counting 'any' types in ${directory}:`, error.message);
    return countAnyTypesManual(directory, allExcludes);
  }
}

/**
 * Manual fallback method to count any types
 */
function countAnyTypesManual(directory, excludePatterns) {
  let count = 0;

  function shouldExclude(filePath) {
    return excludePatterns.some((pattern) => {
      if (pattern.includes("*")) {
        const regex = new RegExp(pattern.replace(/\*/g, ".*"));
        return regex.test(filePath);
      }
      return filePath.includes(pattern);
    });
  }

  function walkDir(dir) {
    if (!fs.existsSync(dir)) return;

    const files = fs.readdirSync(dir);

    files.forEach((file) => {
      const fullPath = path.join(dir, file);

      if (shouldExclude(fullPath)) return;

      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        walkDir(fullPath);
      } else if (file.endsWith(".ts") || file.endsWith(".tsx")) {
        if (!file.endsWith(".spec.ts") && !file.endsWith(".test.ts")) {
          const content = fs.readFileSync(fullPath, "utf8");
          const matches = content.match(/:\s*any\b/g);
          if (matches) {
            count += matches.length;
          }
        }
      }
    });
  }

  walkDir(directory);
  return count;
}

/**
 * Run TypeScript type checking
 */
function runTypeCheck(workspace) {
  console.log(`\n🔍 Running TypeScript check for ${workspace}...`);

  const result = execCommand("npx tsc --noEmit", {
    cwd: path.join(process.cwd(), workspace),
    silent: true,
    returnError: true,
  });

  if (result && result.error) {
    console.log(`  ✗ TypeScript errors found`);
    if (result.output) {
      console.log(result.output.slice(0, 500));
    }
    return false;
  }

  console.log(`  ✓ No TypeScript errors`);
  return true;
}

/**
 * Count ESLint errors
 */
function countEslintErrors(workspace) {
  console.log(`\n🔍 Running ESLint for ${workspace}...`);

  try {
    const workspacePath = path.join(process.cwd(), workspace);

    // Try with compact format to parse errors/warnings
    let output = "";
    try {
      execSync("npx eslint . --format compact", {
        encoding: "utf8",
        cwd: workspacePath,
        stdio: "pipe",
      });
      // If no error, ESLint passed
      console.log(`  ✓ No ESLint errors found`);
      return 0;
    } catch (error) {
      // ESLint exits with error code when there are lint errors
      output = error.stdout || error.output?.[1] || "";
    }

    if (!output || output.trim() === "") {
      console.error(`  ⚠️  No ESLint output received`);
      return -1;
    }

    // Parse compact format: "file: line:col: error - message"
    // Count lines that contain ": error -"
    const lines = output.split("\n");
    const errorCount = lines.filter((line) =>
      line.includes(": error -"),
    ).length;
    const warningCount = lines.filter((line) =>
      line.includes(": warning -"),
    ).length;

    console.log(`  Found ${errorCount} errors, ${warningCount} warnings`);
    return errorCount;
  } catch (error) {
    console.error(`  ⚠️  Error running ESLint: ${error.message}`);
    return -1;
  }
}

/**
 * Main function
 */
function main() {
  console.log("=".repeat(60));
  console.log("📊 Quality Metrics Analysis");
  console.log("=".repeat(60));

  const timestamp = new Date().toISOString();

  // Count any types
  console.log('\n📝 Counting "any" types...');
  const backendAnyCount = countAnyTypesManual(BACKEND_SRC, []);
  console.log(`  Backend: ${backendAnyCount} instances`);

  const frontendAnyCount = countAnyTypesManual(FRONTEND_SRC, [
    "node_modules",
    ".next",
  ]);
  console.log(`  Frontend: ${frontendAnyCount} instances`);

  // Run type checks
  const backendTypeCheckPassed = runTypeCheck("backend");
  const frontendTypeCheckPassed = runTypeCheck("frontend");

  // Count ESLint errors
  const backendEslintErrors = countEslintErrors("backend");
  const frontendEslintErrors = countEslintErrors("frontend");

  // Build metrics object
  const metrics = {
    timestamp,
    backend: {
      anyCount: backendAnyCount,
      typeCheckPassed: backendTypeCheckPassed,
      eslintErrors: backendEslintErrors >= 0 ? backendEslintErrors : "N/A",
    },
    frontend: {
      anyCount: frontendAnyCount,
      typeCheckPassed: frontendTypeCheckPassed,
      eslintErrors: frontendEslintErrors >= 0 ? frontendEslintErrors : "N/A",
    },
    overall: {
      totalAny: backendAnyCount + frontendAnyCount,
      allTypeChecksPassed: backendTypeCheckPassed && frontendTypeCheckPassed,
      totalEslintErrors:
        (backendEslintErrors >= 0 ? backendEslintErrors : 0) +
        (frontendEslintErrors >= 0 ? frontendEslintErrors : 0),
    },
  };

  // Output JSON
  console.log("\n" + "=".repeat(60));
  console.log("📋 JSON Output:");
  console.log("=".repeat(60));
  console.log(JSON.stringify(metrics, null, 2));

  // Output human-readable summary
  console.log("\n" + "=".repeat(60));
  console.log("📊 Summary:");
  console.log("=".repeat(60));
  console.log("\n🔢 Any Types:");
  console.log(`  Backend:  ${backendAnyCount}`);
  console.log(`  Frontend: ${frontendAnyCount}`);
  console.log(`  Total:    ${metrics.overall.totalAny}`);

  console.log("\n✅ Type Checks:");
  console.log(`  Backend:  ${backendTypeCheckPassed ? "✓ PASS" : "✗ FAIL"}`);
  console.log(`  Frontend: ${frontendTypeCheckPassed ? "✓ PASS" : "✗ FAIL"}`);
  console.log(
    `  Overall:  ${metrics.overall.allTypeChecksPassed ? "✓ PASS" : "✗ FAIL"}`,
  );

  console.log("\n⚠️  ESLint Errors:");
  console.log(
    `  Backend:  ${backendEslintErrors >= 0 ? backendEslintErrors : "N/A"}`,
  );
  console.log(
    `  Frontend: ${frontendEslintErrors >= 0 ? frontendEslintErrors : "N/A"}`,
  );
  console.log(
    `  Total:    ${metrics.overall.totalEslintErrors >= 0 ? metrics.overall.totalEslintErrors : "N/A"}`,
  );

  console.log("\n" + "=".repeat(60));

  // Exit with error code if type checks failed
  if (!metrics.overall.allTypeChecksPassed) {
    console.log("❌ Quality checks FAILED");
    process.exit(1);
  } else {
    console.log("✅ Quality checks PASSED");
    process.exit(0);
  }
}

main();
