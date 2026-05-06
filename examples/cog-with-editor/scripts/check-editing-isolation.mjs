import { execFileSync } from "node:child_process";

try {
  const output = execFileSync(
    "rg",
    ["-l", "\\.\\./(components|raster|io)", "src/editing/line-network"],
    { encoding: "utf8" },
  ).trim();

  if (output) {
    console.error(
      `editing/line-network must not import app-only modules:\n${output}`,
    );
    process.exit(1);
  }
} catch (error) {
  if (error && typeof error === "object" && "status" in error && error.status === 1) {
    process.exit(0);
  }

  throw error;
}
