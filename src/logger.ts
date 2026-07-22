import pino from "pino";

let _logger: pino.Logger | null = null;
let _level: pino.LevelWithSilent = "info";

export function setLogLevel(level: pino.LevelWithSilent): void {
  _level = level;
  if (_logger) _logger.level = level;
}

export function getLogger(name?: string): pino.Logger {
  if (!_logger) {
    _logger = pino({
      level: _level,
      transport: {
        target: "pino/file",
        options: { destination: 1 }, // stdout
      },
      ...(name ? { name } : {}),
    });
  }
  return name ? _logger.child({ module: name }) : _logger;
}
