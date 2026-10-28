// One line per event: time, a two-letter tag, the message.
export function log(tag, msg) {
  const t = new Date().toTimeString().slice(0, 8);
  console.log(`${t} ${tag} ${msg}`);
}
