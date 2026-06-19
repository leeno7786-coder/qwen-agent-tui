import { parseArgs } from "util";
import { printDoctorHelp } from "./help";
import { formatDoctorReport, getDoctorReport } from "./reports";

export async function cmdDoctor(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      json: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: false,
    strict: true,
  });

  if (values.help) {
    printDoctorHelp();
    return 0;
  }

  const report = await getDoctorReport();

  if (values.json) {
    console.log(JSON.stringify(report, null, 0));
    return report.ok ? 0 : 1;
  }

  console.log(formatDoctorReport(report).replace(/\n\nCLI:.*$/s, ""));
  return report.ok ? 0 : 1;
}
