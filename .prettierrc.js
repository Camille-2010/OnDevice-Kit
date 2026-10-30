module.exports = {
  arrowParens: 'avoid',
  bracketSameLine: true,
  bracketSpacing: false,
  singleQuote: true,
  trailingComma: 'all',
  // Windows 检出（core.autocrlf=true）下文件是 CRLF，prettier 3 默认 'lf'
  // 会让 ESLint 对整个仓库每行报 "Delete ␍"，lint 门禁形同虚设。
  // 'auto' 跟随文件现有行尾，双平台都能用。
  endOfLine: 'auto',
};
