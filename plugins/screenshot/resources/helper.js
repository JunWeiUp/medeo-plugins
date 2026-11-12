// The plugin's window onto AppKit, run with `osascript -l JavaScript` (always present, no Xcode).
//   screen              → the display under the pointer and the windows on it, front to back
//   copy <png>          → put a PNG (plus TIFF for older apps) on the general pasteboard
//   copy-text <file>    → put the UTF-8 text in <file> on the pasteboard
//   ocr <png>           → text lines (Vision, all languages) and QR/barcode payloads as JSON
//   choose-folder <prompt> <start>  → a folder chosen by the user, or "" when cancelled
// Coordinates are top-left global points, the ones `screencapture -R` and Electron use.
ObjC.import('AppKit');
ObjC.import('CoreGraphics');
ObjC.import('Vision');

function screen() {
  const m = $.NSEvent.mouseLocation, screens = $.NSScreen.screens;
  const mainH = screens.objectAtIndex(0).frame.size.height;
  let display = null;
  for (let i = 0; i < screens.count; i++) {
    const s = screens.objectAtIndex(i), f = s.frame;
    const d = { x: f.origin.x, y: mainH - (f.origin.y + f.size.height), width: f.size.width, height: f.size.height, scale: s.backingScaleFactor };
    if (!display) display = d;
    if (m.x >= f.origin.x && m.x <= f.origin.x + f.size.width && m.y >= f.origin.y && m.y <= f.origin.y + f.size.height) { display = d; break; }
  }
  const raw = $.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly | $.kCGWindowListExcludeDesktopElements, 0);
  const list = ObjC.deepUnwrap(ObjC.castRefToObject(raw)) || [];
  const windows = [];
  for (const w of list) {
    const b = w.kCGWindowBounds;
    if (!b || w.kCGWindowLayer !== 0 || w.kCGWindowAlpha === 0 || b.Width < 24 || b.Height < 24) continue;
    const x = Math.max(b.X, display.x), y = Math.max(b.Y, display.y);
    const r = Math.min(b.X + b.Width, display.x + display.width), btm = Math.min(b.Y + b.Height, display.y + display.height);
    if (r - x < 24 || btm - y < 24) continue;
    windows.push({ x: x - display.x, y: y - display.y, w: r - x, h: btm - y });
  }
  return JSON.stringify({ display, windows: windows.slice(0, 200) });
}

function copy(file) {
  const data = $.NSData.dataWithContentsOfFile(file);
  if (data.isNil()) return 'missing';
  const pb = $.NSPasteboard.generalPasteboard;
  pb.clearContents;
  pb.declareTypesOwner($(['public.png', 'public.tiff']), $());
  pb.setDataForType(data, 'public.png');
  const rep = $.NSBitmapImageRep.imageRepWithData(data);
  if (!rep.isNil()) pb.setDataForType(rep.TIFFRepresentation, 'public.tiff');
  return 'ok';
}

function copyText(file) {
  const text = $.NSString.stringWithContentsOfFileEncodingError(file, $.NSUTF8StringEncoding, $());
  if (text.isNil()) return 'missing';
  const pb = $.NSPasteboard.generalPasteboard;
  pb.clearContents;
  pb.setStringForType(text, 'public.utf8-plain-text');
  return 'ok';
}

function ocr(file) {
  const handler = $.VNImageRequestHandler.alloc.initWithURLOptions($.NSURL.fileURLWithPath(file), $());
  const text = $.VNRecognizeTextRequest.alloc.init;
  text.recognitionLevel = 0; // accurate
  text.usesLanguageCorrection = true;
  if (text.respondsToSelector('setAutomaticallyDetectsLanguage:')) text.automaticallyDetectsLanguage = true;
  const codes = $.VNDetectBarcodesRequest.alloc.init;
  handler.performRequestsError($([text, codes]), $());
  const lines = [], payloads = [];
  const found = text.results;
  if (!found.isNil()) for (let i = 0; i < found.count; i++) {
    const o = found.objectAtIndex(i), top = o.topCandidates(1);
    if (top.count === 0) continue;
    const b = o.boundingBox;
    lines.push({ t: top.objectAtIndex(0).string.js, x: b.origin.x, y: b.origin.y, h: b.size.height });
  }
  const bars = codes.results;
  if (!bars.isNil()) for (let i = 0; i < bars.count; i++) {
    const v = bars.objectAtIndex(i).payloadStringValue;
    if (!v.isNil() && !payloads.includes(v.js)) payloads.push(v.js);
  }
  return JSON.stringify({ lines, codes: payloads });
}

function chooseFolder(prompt, start) {
  const app = Application.currentApplication();
  app.includeStandardAdditions = true;
  app.activate();
  try {
    const options = { withPrompt: prompt };
    if (start && $.NSFileManager.defaultManager.fileExistsAtPath(start)) options.defaultLocation = Path(start);
    return app.chooseFolder(options).toString();
  } catch (e) { return ''; }
}

function run(argv) {
  if (argv[0] === 'screen') return screen();
  if (argv[0] === 'copy') return copy(argv[1]);
  if (argv[0] === 'copy-text') return copyText(argv[1]);
  if (argv[0] === 'ocr') return ocr(argv[1]);
  if (argv[0] === 'choose-folder') return chooseFolder(argv[1] || '', argv[2] || '');
  return 'unknown';
}
