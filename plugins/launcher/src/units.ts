// Unit conversion: "10 km to mi", "100f in c", "1.5gb = mb", "3h to min".
// Every unit is a factor to its category's base unit; temperatures convert through kelvin.
type Category = 'length' | 'mass' | 'volume' | 'area' | 'data' | 'time' | 'speed' | 'temperature';
interface Unit { category: Category; factor: number; symbol: string }
const UNITS = new Map<string, Unit>();
function define(category: Category, symbol: string, factor: number, ...aliases: string[]) {
  for (const name of [symbol, ...aliases]) UNITS.set(name.toLowerCase(), { category, factor, symbol });
}
// Length (metre)
define('length', 'mm', 0.001, 'millimeter', 'millimeters', 'millimetre', 'millimetres', '毫米');
define('length', 'cm', 0.01, 'centimeter', 'centimeters', 'centimetre', 'centimetres', '厘米');
define('length', 'm', 1, 'meter', 'meters', 'metre', 'metres', '米');
define('length', 'km', 1000, 'kilometer', 'kilometers', 'kilometre', 'kilometres', '公里', '千米');
define('length', 'in', 0.0254, 'inch', 'inches', '"', '英寸');
define('length', 'ft', 0.3048, 'foot', 'feet', "'", '英尺');
define('length', 'yd', 0.9144, 'yard', 'yards', '码');
define('length', 'mi', 1609.344, 'mile', 'miles', '英里');
define('length', 'nmi', 1852, 'nautical mile', 'nautical miles', '海里');
// Mass (gram)
define('mass', 'mg', 0.001, 'milligram', 'milligrams', '毫克');
define('mass', 'g', 1, 'gram', 'grams', '克');
define('mass', 'kg', 1000, 'kilogram', 'kilograms', 'kilo', 'kilos', '千克', '公斤');
define('mass', 't', 1e6, 'tonne', 'tonnes', 'ton', 'tons', '吨');
define('mass', 'oz', 28.349523125, 'ounce', 'ounces', '盎司');
define('mass', 'lb', 453.59237, 'lbs', 'pound', 'pounds', '磅');
define('mass', '斤', 500, 'jin');
// Volume (litre)
define('volume', 'ml', 0.001, 'milliliter', 'milliliters', 'millilitre', 'millilitres', '毫升');
define('volume', 'l', 1, 'liter', 'liters', 'litre', 'litres', '升');
define('volume', 'gal', 3.785411784, 'gallon', 'gallons', '加仑');
define('volume', 'qt', 0.946352946, 'quart', 'quarts');
define('volume', 'pt', 0.473176473, 'pint', 'pints');
define('volume', 'cup', 0.2365882365, 'cups');
define('volume', 'floz', 0.0295735295625, 'fl oz', 'fluid ounce', 'fluid ounces');
// Area (square metre)
define('area', 'm2', 1, 'm²', 'sqm', 'square meter', 'square meters', '平方米');
define('area', 'km2', 1e6, 'km²', 'square kilometer', 'square kilometers', '平方公里');
define('area', 'ft2', 0.09290304, 'ft²', 'sqft', 'square foot', 'square feet');
define('area', 'ha', 1e4, 'hectare', 'hectares', '公顷');
define('area', 'acre', 4046.8564224, 'acres', '英亩');
define('area', '亩', 666.6666666667, 'mu');
// Data (byte); decimal and binary prefixes
define('data', 'b', 1, 'byte', 'bytes');
define('data', 'kb', 1e3, 'kilobyte', 'kilobytes');
define('data', 'mb', 1e6, 'megabyte', 'megabytes');
define('data', 'gb', 1e9, 'gigabyte', 'gigabytes');
define('data', 'tb', 1e12, 'terabyte', 'terabytes');
define('data', 'kib', 1024);
define('data', 'mib', 1024 ** 2);
define('data', 'gib', 1024 ** 3);
define('data', 'tib', 1024 ** 4);
// Time (second)
define('time', 'ms', 0.001, 'millisecond', 'milliseconds', '毫秒');
define('time', 's', 1, 'sec', 'secs', 'second', 'seconds', '秒');
define('time', 'min', 60, 'mins', 'minute', 'minutes', '分钟');
define('time', 'h', 3600, 'hr', 'hrs', 'hour', 'hours', '小时');
define('time', 'd', 86400, 'day', 'days', '天');
define('time', 'wk', 604800, 'week', 'weeks', '周');
define('time', 'yr', 31557600, 'year', 'years', '年');
// Speed (metre per second)
define('speed', 'm/s', 1, 'mps');
define('speed', 'km/h', 1 / 3.6, 'kmh', 'kph');
define('speed', 'mph', 0.44704);
define('speed', 'kn', 0.514444, 'knot', 'knots', '节');
// Temperature: factor unused
define('temperature', '°C', 1, 'c', 'celsius', '℃', '摄氏度');
define('temperature', '°F', 1, 'f', 'fahrenheit', '℉', '华氏度');
define('temperature', 'K', 1, 'k', 'kelvin');

function toKelvin(value: number, symbol: string): number {
  return symbol === '°C' ? value + 273.15 : symbol === '°F' ? (value - 32) * 5 / 9 + 273.15 : value;
}
function fromKelvin(value: number, symbol: string): number {
  return symbol === '°C' ? value - 273.15 : symbol === '°F' ? (value - 273.15) * 9 / 5 + 32 : value;
}
const unit = (name: string) => UNITS.get(name.trim().toLowerCase().replace(/^°\s*(?=[cf]$)/, ''));

export interface Conversion { value: number; from: string; to: string; result: number }

/** `<number> <unit> (to|in|as|=|->|→) <unit>`, or null. */
export function convert(input: string): Conversion | null {
  const match = /^\s*(-?\d[\d,]*(?:\.\d+)?|-?\.\d+)\s*(.+?)\s+(?:to|in|as|into|=|->|→|换成|转)\s*(.+?)\s*$/i.exec(input)
    ?? /^\s*(-?\d[\d,]*(?:\.\d+)?|-?\.\d+)\s*(.+?)\s*(?:=|->|→)\s*(.+?)\s*$/i.exec(input);
  if (!match) return null;
  const value = Number(match[1].replace(/,/g, ''));
  const from = unit(match[2]), to = unit(match[3]);
  if (!Number.isFinite(value) || !from || !to || from.category !== to.category) return null;
  const result = from.category === 'temperature'
    ? fromKelvin(toKelvin(value, from.symbol), to.symbol)
    : value * from.factor / to.factor;
  return { value, from: from.symbol, to: to.symbol, result };
}
