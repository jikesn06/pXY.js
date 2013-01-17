/*
* Copyright (c) 2012, Leon Sorokin
* All rights reserved. (MIT Licensed)
*
* pXY.js - pixel analysis for HTML5 Canvas
*/

function pXY(ctx, bbox) {
	this.ctx = null;		// ImageData or parent pXY, *NOT* a 2d context
	this.can = null;
	this.pxls = null;		// px array

	// pXY
	if (ctx instanceof pXY) {
		this.ctx = ctx;
		this.pxls = ctx.pxls;
		this.gray = ctx.gray;
	}
	else {
		// web workers have no access to DOM prototypes for instanceof to work
		var type = Object.prototype.toString.call(ctx).match(/^\[object (.*)\]$/)[1];
		switch (type) {
			// <img>
			case "HTMLImageElement":
				var can		= document.createElement("canvas");
				can.width	= ctx.width;
				can.height	= ctx.height;
				this.can	= can;

				var ctx2d = can.getContext("2d");
				ctx2d.drawImage(ctx, 0, 0);

				// replace original image w/canvas
				ctx.parentNode.replaceChild(can, ctx);

				this.ctx = ctx2d.getImageData(0, 0, ctx.width, ctx.height);
				break;
			// <canvas>
			case "HTMLCanvasElement":
				this.can	= ctx;
				var ctx2d	= ctx.getContext("2d");
				this.ctx	= ctx2d.getImageData(0, 0, ctx.width, ctx.height);
				break;
			// ImageData
			case "ImageData":
				this.ctx = ctx;
				break;
			// grayscale px array
			case "Array":
			case "Uint8Array":
			case "Uint8ClampedArray":
				this.gray = true;
				this.ctx = {
					data: ctx,
					width: bbox.w,
					height: bbox.h,
				};
				break;
		}

		this.ctx.lft = 0;
		this.ctx.top = 0;
		this.ctx.w = this.ctx.width;
		this.ctx.h = this.ctx.height;

		this.pxls = this.ctx.data;
	}

	// bbox
	this.lft = bbox ? bbox.lft : 0;
	this.top = bbox ? bbox.top : 0;
	this.rgt = bbox ? bbox.rgt : this.ctx.w - 1;
	this.btm = bbox ? bbox.btm : this.ctx.h - 1;
	this.w = this.rgt - this.lft + 1;
	this.h = this.btm - this.top + 1;

	// current pos
	this.x = null;
	this.y = null;
	this.hist = [];		// position save stack
	this.ok = true;

	// px object at current pos (cache)
	this._px = null;
	// direct props proxies
	this.r = null;
	this.g = null;
	this.b = null;
	this.a = null;
	// grayscale value
	this.v = null;
	this.gray = this.gray || false;

	// event subscriber registry
	this.subs = [
	//	[fn, ctx],
	];

	// accumulated offset cache
	this.offs = {};
}

(function() {
	pXY.load = function loadImg(src, fn) {
		var img = new Image();

		img.onload = function() {
			var can = document.createElement("canvas"),
				ctx = can.getContext("2d"),
				pxy = null,
				imgd = null;

			can.width = img.width;
			can.height = img.height;
			ctx.drawImage(img, 0, 0);

			// create a pXY instance from ImageData
			imgd = ctx.getImageData(0, 0, img.width, img.height);
			pxy = new pXY(imgd);
			pxy.can = can;

			fn.call(pxy, can, ctx, img, imgd);
		};

		img.src = src;
	};

	function round(val) {
		return (val + 0.5) << 0;
	}

	function rand(min, max) {
		return Math.floor(Math.random()*(max-min+1)+min);
	}

	function xy2idx(x,y,w) {
		return y * w + x;
	}

	function idx2xy(idx,w) {
		return {x: idx % w, y: Math.floor(idx/w)};
	}

	// bbox from coords, width, height
	function xywh(x,y,w,h) {
		if (w < 0) {
			x += w + 1;
			w *= -1;
		}

		if (h < 0) {
			y += h + 1;
			h *= -1;
		}

		return {
			top: y,
			rgt: x + w - 1,
			btm: y + h - 1,
			lft: x,
			w: w,
			h: h
		};
	}

	// bbox from opposite corners
	function xyxy(x0,y0,x1,y1) {
		var bb = {
			top: Math.min(y0,y1),
			rgt: Math.max(x0,x1),
			btm: Math.max(y0,y1),
			lft: Math.min(x0,x1)
		};

		bb.w = bb.rgt - bb.lft + 1;
		bb.h = bb.btm - bb.top + 1;

		return bb;
	}

	// bbox from opposite corner indicies
//	function idid(idx0, idx1) {}
	// bbox from edge offsets
//	function offs(t,r,b,l) {}

/*----------------------------------Pixel and color funcs--------------------------------*/
	// background used for alpha-composition
	var bgRgb = [255,255,255];

	// all 0-255
	function px(r,g,b,a) {
		this.r = r;
		this.g = g;
		this.b = b;
		this.a = a;

		this._hsv = null;
		this._lum = null;
	}

		px.prototype.hsv = function hsv() {
			if (!this._hsv) {
				var rgb = rgba2rgb([this.r, this.g, this.b, this.a], bgRgb);
				this._hsv = rgb2hsv(rgb[0], rgb[1], rgb[2]);
			}
			return this._hsv;
		};

		px.prototype.hue = function hue() {
			if (!this._hsv)
				this.hsv();
			return this._hsv[0];
		};

		px.prototype.sat = function sat() {
			if (!this._hsv)
				this.hsv();
			return this._hsv[1];
		};

		px.prototype.lum = function lum() {
			if (!this._lum)
				this._lum = rgbaLumOnRgb([this.r, this.g, this.b, this.a], bgRgb);
			return this._lum;
		};

	function pxGray(v) {
		this.r = null;
		this.g = null;
		this.b = null;
		this.a = 255;

		this.v = v;
	}

		function nullRet() {
			return null;
		}

		pxGray.prototype.hsv = nullRet;

		pxGray.prototype.hue = nullRet;

		pxGray.prototype.sat = nullRet;

		pxGray.prototype.lum = function() {
			return this.v;
		};

	// rgba px lum against rgb bg
	function rgbaLumOnRgb(fg, bg) {
		var c
			= fg[3] == 255 ? fg 	// opaque fg
			: fg[3] == 0 ? bg		// transparent fg
			: rgba2rgb(fg, bg);		// alpha-composed

		return c[0] == 255 && c[1] == 255 && c[2] == 255 ? 255 : round(rgb2lum(c[0],c[1],c[2]));
	}

	// perceived luminance
	// http://stackoverflow.com/questions/596216/formula-to-determine-brightness-of-rgb-color
	/*
	// Rec. 601 (NTSC) luma coef
	var Pr = .299,
		Pg = .587,
		Pb = .114;
	*/
	// Rec. 709 (sRGB) luma coef
	var Pr = .2126,
		Pg = .7152,
		Pb = .0722;

	function rgb2lum(r,g,b) {
		return Math.sqrt(
			Pr * r*r +
			Pg * g*g +
			Pb * b*b
		);
	}

	// alpha composition
	// http://en.wikipedia.org/wiki/Alpha_compositing
	// fg is rgba, bg is rgb
	function rgba2rgb(fg, bg) {
		return [
			round((fg[0]*fg[3] + bg[0]*(255-fg[3]))/255),
			round((fg[1]*fg[3] + bg[1]*(255-fg[3]))/255),
			round((fg[2]*fg[3] + bg[2]*(255-fg[3]))/255),
		];
	}

	// optionally skip hue calc
	function rgb2hsv(r, g, b, noHue) {
		r /= 255; g /= 255; b /= 255;

		var max = Math.max(r, g, b),
			min = Math.min(r, g, b),
			delta = max - min,
			sat = delta == 0 ? 0 : delta/max;

		if (noHue) return [undefined, sat, max];

		var f = (r == min) ? g - b : ((g == min) ? b - r : r - g),
			i = (r == min) ? 3 : ((g == min) ? 5 : 1),
			hue = 60 * (i - f/delta);

		return [hue, sat, max];
	}

	// http://alienryderflex.com/hsp.html
	function rgb2hsp(r, g, b) {
		var hsv = rgb2hsv(r, g, b);

		r /= 255; g /= 255; b /= 255;

		var p = rgb2lum(r,g,b);

		return [hsv[0], hsv[1], p];
	}
/*---------------------------------------------------------------------------------------*/

	// modules
	var mods = {
		// pub/sub
		event: {
			sub: function sub(fn, ctx) {
				ctx = ctx || this;
				this.subs.push([fn, ctx]);
				return this;
			},

			unsub: function unsub(fn, ctx) {
				ctx = ctx || this;
				this.subs = this.subs.filter(
					function(fnCtx) {
						if (fnCtx[0] !== fn && fnCtx[1] !== ctx) return fnCtx;
					}
				);
				return this;
			},

			pub: function pub(evt) {
				this.subs.forEach(
					function(fnCtx) {
						fnCtx[0].call(fnCtx[1], evt);
					}
				);
				return this;
			},
		},

		// abs/rel pixel index and bbox offset calcs
		idxoff: {
			relOff: function relOff(lvl) {
				if (this.offs[lvl]) return this.offs[lvl];

				var i = lvl, off = {top: this.top, lft: this.lft}, ctx = this;
				while (--i > 0 && ctx.ctx) {
					ctx = ctx.ctx;
					off.top += ctx.top;
					off.lft += ctx.lft;
				}
				off.w = ctx.w;		// odd, but needed for common follow-up idx calcs
				this.offs[lvl] = off;
				return off;
			},

			relIdx: function relIdx(lvl, x, y) {
				var off = this.relOff(lvl);
				return xy2idx(off.lft + (x || x === 0 ? x : this.x), off.top + (y || y === 0 ? y : this.y), off.w);
			},

			relXy: function relXy(lvl, x, y) {
				var off = this.relOff(lvl);
				return {x: off.lft + (x || x === 0 ? x : this.x), y: off.top + (y || y === 0 ? y : this.y)};
			},

			// shorthands
			absOff: function absOff() {
				return this.relOff(10000);
			},

			absIdx: function absIdx(x, y) {
				return this.relIdx(10000, x, y);
			},

			absXy: function absXy(x, y) {
				return this.relXy(10000, x, y);
			},

			absPos: function absPos() {
				var pos = this.absXy();
				pos.i = this.absIdx();
				return pos;
			},
		},

		pxstuff: {
			px: function getPx(x, y, abs) {
				// default to current pos
				x = x || 0;
				y = y || 0;

				x += !abs ? this.x : 0;
				y += !abs ? this.y : 0;

				if (x < 0 || y < 0 || x >= this.w || y >= this.h)
					return null;

				// optimization for normalized external use, prevents re-calc
				if (this._px && x == this.x && y == this.y)
					return this._px;

				var i = this.absIdx(x, y);

				return this.gray ? new pxGray(this.pxls[i]) : new px(this.pxls[i*=4], this.pxls[++i], this.pxls[++i], this.pxls[++i]);
			},

			// sync px under position
			updPx: function updPx() {
				var px = this.px();

				this._px	= px;

				if (this.gray)
					this.v		= px.v;
				else {
					this.r		= px.r;
					this.g		= px.g;
					this.b		= px.b;
					this.a		= px.a;
				}
			},

			// convert full canvas to grayscale
			toGray: function(show) {
				if (this.gray) return this;

				var len = this.pxls.length;

				if (show) {
					var buf = new ArrayBuffer(len),
						buf8 = new Uint8Array(buf),
						buf32 = new Uint32Array(buf);
				}

				var pxls = new Uint8Array(len/4), i = -1, f = -1, lum;
				while (i < len) {
					lum = rgbaLumOnRgb([this.pxls[++i], this.pxls[++i], this.pxls[++i], this.pxls[++i]], bgRgb);
					pxls[++f] = lum;
					show && (buf32[f] = (255 << 24) | (lum << 16) | (lum << 8) | lum);
				}

				this.pxls = pxls;
				this.gray = true;

				this.updPx();

				this.r = null;
				this.g = null;
				this.b = null;
				this.a = 255;

				if (show) {
					this.ctx.data.set(buf8);
					this.can && this.can.getContext("2d").putImageData(this.ctx, 0, 0);
				}

				// bye-bye huge ImageData
				this.ctx = {
					data: pxls,
					width: this.ctx.width,
					height: this.ctx.height,
				};

				return this;
			},
		},

		// computed props proxies for current px
		pxprox: {
			hue: function() {
				return this._px.hue();
			},

			sat: function() {
				return this._px.sat();
			},

			lum: function() {
				return this._px.lum();
			},
		},

		move: {
			// absolute
			moveTo: function moveTo(x, y, updPx, noPub) {
				if (x < 0 || y < 0 || x >= this.w || y >= this.h) {
					this.ok = false;
					return this;
				}

				if (x == this.x && y == this.y) return this;

				// moving! reset some stuff
				this.ok = true;
				this._px = null;

				// account for single axis moves
				x = x === null ? this.x : x;
				y = y === null ? this.y : y;

				this.x = x;
				this.y = y;

				!(updPx === false) && this.updPx();

				// publish move event
				if (!noPub && this.subs.length) {
					this.pub({type: 0, pxy: this});
				}

				return this;
			},

			// corner shorthands
			moveTl: function moveTl() {
				return this.moveTo(0, 0);
			},

			moveTr: function moveTr() {
				return this.moveTo(this.w - 1, 0);
			},

			moveBr: function moveBr() {
				return this.moveTo(this.w - 1, this.h - 1);
			},

			moveBl: function moveBl() {
				return this.moveTo(0, this.h - 1);
			},

			// relative
			moveBy: function moveBy(stepX, stepY, updPx, noPub) {
				return this.moveTo(this.x + stepX, this.y + stepY, !(updPx === false), noPub || false);
			},
		},

		// position stack
		posstack: {
			// saves current position
			push: function push() {
				this.hist.push({x: this.x, y: this.y});
				return this;
			},

			// restores last saved position
			// by default does not publish move event
			pop: function pop(pub) {
				var pos = this.hist.pop();
				this.moveTo(pos.x, pos.y, true, !pub);
				return this;
			},
		},

		scan: {
			// base for scanners
			scan: function scan(nextXY, fn) {
				var getNext = nextXY instanceof Array ? function() {return [this.x + nextXY[0], this.y + nextXY[1]];} : nextXY;

				// publish scan start event
				if (this.subs.length) {
					var scanId = rand(10000,99999);
					this.pub({type: 1, id: scanId, pxy: this});
				}

				// move, get pixels, check tolers, run callback
				var next, fnChk = true, stepCnt = 0;
				do {
					fn && (fnChk = fn.call(this, stepCnt++));		// TODO: pass in nextXY calc func?
					next = getNext.apply(this);
				} while (fnChk !== false && next && this.moveTo(next[0], next[1]).ok);

				// publish scan end event
				this.subs.length && this.pub({type: 2, id: scanId, pxy: this});

				return this;
			},

			// unidirectional scanners (1px default step)
			scanRt: function scanRt(fn, stepX) {
				stepX = Math.abs(stepX || 1);
				return this.scan.call(this, [stepX, 0], fn || null);
			},

			scanDn: function scanDn(fn, stepY) {
				stepY = Math.abs(stepY || 1);
				return this.scan.call(this, [0, stepY], fn || null);
			},

			scanLf: function scanLf(fn, stepX) {
				stepX = Math.abs(stepX || 1);
				return this.scan.call(this, [-stepX, 0], fn || null);
			},

			scanUp: function scanUp(fn, stepY) {
				stepY = Math.abs(stepY || 1);
				return this.scan.call(this, [0, -stepY], fn || null);
			},

			// random scanner
			scanRand: function scanRand(fn) {
				function nextXY() {
					return [
						rand(0, this.w-1),
						rand(0, this.h-1)
					];
				}
				return this.scan.call(this, nextXY, fn || null);
			},

			// base for bidirectional scanners
			// ori = primary axis orientation (0 = horiz, 1 = vert)
			scanBi: function scanBi(ori, fn, stepX, stepY) {
				stepX = stepX || 1;
				stepY = stepY || 1;

				var _lft = 0,
					_top = 0,
					_rgt = this.w - 1,
					_btm = this.h - 1;

				// secondary axis advancing functions
				switch(ori) {
					case 0:
						var nextXY = function nextXY() {
							var nxtX = this.x + stepX;
							if (stepX > 0 && nxtX > _rgt)
								return [_lft, this.y + stepY];
							if (stepX < 0 && nxtX < _lft)
								return [_rgt, this.y + stepY];
							return [nxtX, this.y];
						};
						break;
					case 1:
						var nextXY = function nextXY() {
							var nxtY = this.y + stepY;
							if (stepY > 0 && nxtY > _btm)
								return [this.x + stepX, _top];
							if (stepY < 0 && nxtY < _top)
								return [this.x + stepX, _btm];
							return [this.x, nxtY];
						};
						break;
				}
				return this.scan.call(this, nextXY, fn);
			},

			scanXY: function scanXY(fn, stepX, stepY) {
				var args = Array.prototype.slice.call(arguments);
				args.unshift(0);
				return this.scanBi.apply(this, args);
			},

			scanYX: function scanYX(fn, stepX, stepY) {
				var args = Array.prototype.slice.call(arguments);
				args.unshift(1);
				return this.scanBi.apply(this, args);
			},
		},

		// sectioning helpers
		subpxy: {
			xywh: function(x,y,w,h) {
				return new pXY(this, xywh(x,y,w,h));
			},

			xyxy: function(x0,y0,x1,y1) {
				return new pXY(this, xyxy(x0,y0,x1,y1));
			},
		},
	};

	// combine modules into proto
	for (var i in mods) {
		for (var j in mods[i]) {
			pXY.prototype[j] = mods[i][j];
		}
	}
})();