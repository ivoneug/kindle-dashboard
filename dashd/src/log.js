// One line per event: time, a two-letter tag, the message.
export function log(tag, ...args) {
  const t = new Date().toTimeString().slice(0, 8);
  console.log(`${t} ${tag} ${args.map(String).join(' ')}`.slice(0, 800));
}
