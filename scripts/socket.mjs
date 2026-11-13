import { SOCKET } from "./constants.mjs";

/**
 * Module socket messages. The server relays them to every other connected client.
 *   {op: "drag", sceneId, cardId, x, y, width, height}  live preview while someone drags a card
 *   {op: "dragEnd", sceneId, cardId}                    the drag finished or was cancelled
 *   {op: "focus", sceneId, cardId, users}               a GM takes everyone (or these user ids) to this card
 */
const handlers = {};

export function onSocket(op, fn) {
  handlers[op] = fn;
}

export function emit(op, data) {
  game.socket.emit(SOCKET, { op, ...data });
}

export function registerSocket() {
  game.socket.on(SOCKET, (message, senderId) => {
    const fn = handlers[message?.op];
    if ( fn ) fn(message, senderId);
  });
}
