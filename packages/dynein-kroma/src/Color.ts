export default class Color {
	r: number
	g: number
	b: number
	a: number

	constructor(hex: string | number, a: number = 1) {
		if (typeof hex === "string") {
			if (hex.startsWith("#")) {
				hex = hex.substring(1)
			}
			if (hex.length === 3) {
				hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2]
			}
			hex = parseInt(hex, 16)
		}
		this.b = (hex & 0xFF) / 0xFF
		hex >>= 8
		this.g = (hex & 0xFF) / 0xFF
		hex >>= 8
		this.r = (hex & 0xFF) / 0xFF
		this.a = a
	}

	//Adapted from https://stackoverflow.com/a/54070620
	private get _hsv() {
		const r = this.r
		const g = this.g
		const b = this.b
		const v=Math.max(r,g,b), c=v-Math.min(r,g,b);
		const h = (c && ((v==r) ? (g-b)/c : ((v==g) ? 2+(b-r)/c : 4+(r-g)/c)))/6;
		return {h: (h<0?h+1:h), s: v&&c/v, v}
	}

	private setHsv(h: number, s: number, v: number) {
		const k = (n: number) => (n + h*6) % 6
		const f = (n: number) => v-v*s*Math.max(0, Math.min(k(n), 4-k(n), 1))
		this.r = f(5)
		this.g = f(3)
		this.b = f(1)
	}

	get h() {
		return this._hsv.h
	}

	get s() {
		return this._hsv.s
	}

	get v() {
		return this._hsv.v
	}

	set h(h: number) {
		this.setHsv(h, this.s, this.v)
	}

	set s(s: number) {
		this.setHsv(this.h, s, this.v)
	}

	set v(v: number) {
		this.setHsv(this.h, this.s, v)
	}

	//https://www.w3.org/TR/WCAG20/#relativeluminancedef
	get relativeLuminance() {
		const R = this.r <= 0.03928 ?  this.r/12.92 : ((this.r+0.055)/1.055) ** 2.4
		const G = this.g <= 0.03928 ?  this.g/12.92 : ((this.g+0.055)/1.055) ** 2.4
		const B = this.b <= 0.03928 ?  this.b/12.92 : ((this.b+0.055)/1.055) ** 2.4
		return 0.2126 * R + 0.7152 * G + 0.0722 * B
	}

	toString() {
		const rgb = [this.r, this.g, this.b].map(n => Math.floor(Math.max(0, Math.min(1, n))*255)).join(",")

		return `rgba(${rgb},${this.a})`
	}

	dist(color: Color) {
		return Math.hypot(this.r-color.r, this.g-color.g, this.b-color.b)
	}

	contrast(color: Color) {
		const thisL = this.relativeLuminance
		const thatL = color.relativeLuminance
		const L1 = thisL > thatL ? thisL : thatL
		const L2 = thisL > thatL ? thatL : thisL
		return (L1 + 0.05) / (L2 + 0.05)
	}

	maxContrast(colors: string[]): string {
		let maxRatio = 1
		let maxColor = colors[0]
		for (const color of colors) {
			const ratio = this.contrast(new Color(color))
			if (ratio > maxRatio) {
				maxRatio = ratio
				maxColor = color
			}
		}
		return maxColor
	}

	clone() {
		const out = new Color(0)
		out.r = this.r
		out.g = this.g
		out.b = this.b
		out.a = this.a
		return out
	}

	mix(other: Color, factor: number) {
		const clone = this.clone()
		const f1 = 1-factor
		clone.r = f1*this.r + factor*other.r
		clone.g = f1*this.g + factor*other.g
		clone.b = f1*this.b + factor*other.b
		clone.a = f1*this.a + factor*other.a
		return clone
	}
}


//0xf0f0f0/0xfff
//0xd0d0e0/0xdde
