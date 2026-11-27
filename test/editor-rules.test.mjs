import { test } from "node:test";
import assert from "node:assert/strict";
import { DIVIDER_RULE, SLASH_ITEMS, filterSlashItems, markRuleFor, slashQuery } from "../scripts/editor-rules.mjs";

const label = item => ({
  paragraph: "Text", heading1: "Heading 1", heading2: "Heading 2", heading3: "Heading 3", bullet: "Bulleted list",
  ordered: "Numbered list", quote: "Quote", secret: "Secret", divider: "Divider", code: "Code"
})[item.id];

test("every slash item has an icon and keywords", () => {
  const ids = new Set();
  for ( const item of SLASH_ITEMS ) {
    assert.match(item.icon, /^fa-/);
    assert.ok(item.keywords.length);
    assert.ok(!ids.has(item.id));
    ids.add(item.id);
  }
});

test("filterSlashItems: empty query lists everything in order", () => {
  assert.deepEqual(filterSlashItems(SLASH_ITEMS, "", label).map(i => i.id), SLASH_ITEMS.map(i => i.id));
});

test("filterSlashItems: label and keyword prefixes first, then contains", () => {
  const h = filterSlashItems(SLASH_ITEMS, "h", label).map(i => i.id);
  assert.deepEqual(h.slice(0, 3), ["heading1", "heading2", "heading3"]);
  assert.deepEqual(filterSlashItems(SLASH_ITEMS, "h2", label).map(i => i.id), ["heading2"]);
  assert.deepEqual(filterSlashItems(SLASH_ITEMS, "list", label).map(i => i.id), ["bullet", "ordered"]);
  assert.equal(filterSlashItems(SLASH_ITEMS, "QUO", label)[0].id, "quote");
  assert.deepEqual(filterSlashItems(SLASH_ITEMS, "zzz", label), []);
});

test("slashQuery opens at the start of a block or after a space only", () => {
  assert.equal(slashQuery("/"), "");
  assert.equal(slashQuery("/head"), "head");
  assert.equal(slashQuery("Some text /li"), "li");
  assert.equal(slashQuery("and/or"), null);
  assert.equal(slashQuery("https://example.com/x"), null);
  assert.equal(slashQuery("/two words"), null);
  assert.equal(slashQuery(""), null);
  assert.equal(slashQuery("/überschrift"), "überschrift");
});

test("markRuleFor: Markdown-style marks", () => {
  const check = (text, mark, inner) => {
    const found = markRuleFor(text);
    assert.ok(found, text);
    assert.equal(found.mark, mark, text);
    assert.equal(found.match[1], inner, text);
  };
  check("say **this**", "strong", "this");
  check("**two words**", "strong", "two words");
  check("an *aside*", "em", "aside");
  check("_quiet_", "em", "quiet");
  check("~~gone~~", "strikethrough", "gone");
  check("run `ls -la`", "code", "ls -la");
});

test("markRuleFor leaves ordinary text alone", () => {
  for ( const text of ["2*3*", "snake_case_", "**", "* not *", "** spaced**", "a*b*", "half **open*", "~one~"] ) {
    assert.equal(markRuleFor(text), null, text);
  }
});

test("DIVIDER_RULE matches a line of three", () => {
  for ( const s of ["---", "***", "___"] ) assert.ok(DIVIDER_RULE.test(s));
  for ( const s of ["--", "----", "-*-", "a---"] ) assert.ok(!DIVIDER_RULE.test(s));
});
