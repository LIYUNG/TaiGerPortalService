// CJS stub for nanoid - used in Jest tests to replace the ESM-only nanoid package
const nanoid = (size = 21) => {
  const chars =
    'useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict';
  let id = '';
  for (let i = 0; i < size; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
};

module.exports = { nanoid };
