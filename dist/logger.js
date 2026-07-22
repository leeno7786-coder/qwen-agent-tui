import pino from 'pino';
let _logger = null;
let _level = 'info';
export function setLogLevel(level) {
    _level = level;
    if (_logger)
        _logger.level = level;
}
export function getLogger(name) {
    if (!_logger) {
        _logger = pino({
            level: _level,
            transport: {
                target: 'pino/file',
                options: { destination: 1 }, // stdout
            },
            ...(name ? { name } : {}),
        });
    }
    return name ? _logger.child({ module: name }) : _logger;
}
