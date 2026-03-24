import { useEffect, useState } from "react";
import { useStdout } from "ink";

function readRows(): number {
  try {
    return Deno.consoleSize().rows;
  } catch {
    return 24;
  }
}

export function useTerminalRows(): number {
  const { stdout } = useStdout();
  const [rows, setRows] = useState(readRows);

  useEffect(() => {
    const onResize = () => setRows(readRows());
    stdout?.on?.("resize", onResize);
    return () => {
      stdout?.off?.("resize", onResize);
    };
  }, [stdout]);

  return rows;
}
