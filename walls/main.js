"use strict";

import {point, vec2} from "./vectorMath.js";

const coinToss = () => Math.random() > 0.5;
const rndNeg = num => num * (coinToss() ? 1 : -1);
const rndBetween = (min, max) => Math.random() * (max - min) + min;
const log = (...args) => { if (logging) console.log(...args); };

const canvas = document.querySelector("canvas");
const ctx = canvas.getContext("2d");
let w, h;

const targetFPS = 60;
const targetFT = 1000 / targetFPS;
const clock = {
    acc: 0,
    pts: null // prev timestamp
};

const tau = Math.PI * 2;

const walls = [];
let drawingWall = null;
let wallIdCount = 0;
const wallThickness = 20;

let test = 0;
let pause = false;
let logging = false;
const debug = {
    drag: false,
    drawText: true,
    drawVertices: false,
    drawEdgeNormals: false,
    text: "",
    verts: [],
    lines: []
};


////// BALL //////

const ball = {
    colliding: false,
    x: 0,
    y: 0,
    px: 0,
    py: 0,
    dx: 0,
    dy: 0,
    speed: 4,
    radius: 18,
    project: function(vec) {
        const p = this.x * vec.x + this.y * vec.y;
        const min = p - this.radius;
        const max = p + this.radius;
        return [min, max];
    },
    update: function() {
        
        // move
        this.px = this.x;
        this.py = this.y;
        if (this.x + this.radius < -1)    this.x = this.radius + w;
        if (this.y + this.radius < -1)    this.y = this.radius + h;
        if (this.x - this.radius > w + 1) this.x = -this.radius;
        if (this.y - this.radius > h + 1) this.y = -this.radius;
        
        if (debug.drag && ptr.isDown) {
            this.x = ptr.x;
            this.y = ptr.y - 300;
            this.dx = this.x - this.px;
            this.dy = this.x - this.py;
        } else {
            this.x += this.dx * this.speed;
            this.y += this.dy * this.speed;
        }
        
        debug.text = "";
        // check collisions
        // separating axis theorem baybeeeee
        for (let w of walls) {
            let eCollision = true;
            let vCollision = true;
            let minOverlap = Infinity;
            let minOverlapAxis;
            
            // 1. Get edge normal projections
            // only need 2 for rects/squares
            for (let i = 0; i < 2; i++) {
                const e = w.edges[i];
                // project ball onto edge normal
                const [bmin, bmax] = this.project(e.normal);
                // project wall verts onto edge normal
                const [wmin, wmax] = w.project(e.normal);
                // compare projections, get min overlap + axis
                // collision = bmin < wmax && bmax > wmin
                if (bmin < wmax) {
                    let o = wmax - bmin;
                    if (o < minOverlap) {
                        minOverlap = o;
                        minOverlapAxis = e.normal;
                    }
                    if (bmax > wmin) {
                        o = bmax - wmin;
                        if (o < minOverlap) {
                            minOverlap = o;
                            minOverlapAxis = e.normal;
                        }
                    } else eCollision = false;
                } else eCollision = false;
                if (!eCollision) break;
            }
            
            // 2. Project onto vector created from
            //    ball center to nearest wall vert
            // get nearest vert:
            let minDx, minDy, d;
            let minD = Infinity;
            for (let v of w.vertices) {
                const dx = v.x - this.x;
                const dy = v.y - this.y;
                d = dx * dx + dy * dy;
                if (d < minD) {
                    minDx = dx;
                    minDy = dy;
                    minD = d;
                }
            }
            d = Math.sqrt(minD);
            const ud = new vec2(minDx / d, minDy / d);
            
            // ball projection
            const [bmin, bmax] = this.project(ud);
            // project wall verts
            const [wmin, wmax] = w.project(ud);
            
            // compare
            if (bmin < wmax) {
                let o = wmax - bmin;
                if (o < minOverlap) {
                    minOverlap = o;
                    minOverlapAxis = ud;
                }
                if (bmax > wmin) {
                    o = bmax - wmin;
                    if (o < minOverlap) {
                        minOverlap = o;
                        minOverlapAxis = ud;
                    }
                } else vCollision = false;
            } else vCollision = false;
            
            // 3. Final check
            if (eCollision && vCollision) {
                this.colliding = true;
                const collisionVec = minOverlapAxis.flipped();
                
                // 4. Resolve
                // not great
                this.x -= this.dx * minOverlap;
                this.y -= this.dy * minOverlap;
                
                // 5. Reflect
                let dir = new vec2(this.dx, this.dy);
                dir = dir.reflect(collisionVec);
                this.dx = dir.x;
                this.dy = dir.y;
                
                // collide with only one wall:
                break;
            } else {
                this.colliding = false;
            }
        }
    },
    draw: function(inter) {
        let tx, ty; // transform/translate
        if (inter) {
            tx = (this.x - this.px) * inter + this.px;
            ty = (this.y - this.py) * inter + this.py;
        } else {
            tx = this.x;
            ty = this.y;
        }
        ctx.fillStyle = this.colliding ? "#ff2f2f44" : "#30cd9f";
        ctx.strokeStyle = this.colliding ? "#c1000077" : "#0a7c67";
        ctx.lineWidth = 4; // increases radius btw
        ctx.beginPath();
        ctx.arc(tx, ty, this.radius - 1.5, 0, tau);
        ctx.stroke();
        ctx.fill();
        if (debug.drawVertices) {
            ctx.fillStyle = this.colliding ? "#c1000077" : "#0a7c67";
            ctx.beginPath();
            ctx.arc(tx, ty, 2, 0, tau);
            ctx.fill();
        }
    }
};


////// WALL CLASS //////

class wall {
    constructor(startx, starty) {
        this.id = null;
        this.start = new vec2(startx, starty);
        this.end   = new vec2(startx, starty);
        
        this.vertices = [];
        this.edges = [];
        /* edges format:
            id: id,
            v: [vertexA, vertexB],
            normal: vec2 */
    }
    place() {
        wallIdCount++;
        this.id = wallIdCount;
        
        // get vertices from start/end points
        const normal = this.end.subtract(this.start).normalize().getNormal();
        const t = normal.scale(wallThickness / 2); // translation
        
        // set vertices
        this.vertices = [
            this.start.add(t),
            this.end.add(t),
            this.end.subtract(t),
            this.start.subtract(t)
        ];
        
        // set edges + normals
        for (let i = 0; i < 4; i++) {
            const a = this.vertices[i];
            const b = this.vertices[(i + 1) % 4];
            const d = new vec2(b.x - a.x, b.y - a.y);
            const n = d.normalize().getNormal();
            this.edges.push({id: i+1, v: [a, b], normal: n});
        }
        walls.push(this);
    }
    project(vec) {
        let min = Infinity;
        let max = -Infinity;
        for (let v of this.vertices) {
            const proj = vec.dot(v);
            if (proj < min) min = proj;
            if (proj > max) max = proj;
        }
        return [min, max];
    }
    draw() {
        const [v1, v2, v3, v4] = this.vertices;
        ctx.fillStyle = "#000000";
        ctx.beginPath();
        ctx.moveTo(v1.x, v1.y);
        ctx.lineTo(v2.x, v2.y);
        ctx.lineTo(v3.x, v3.y);
        ctx.lineTo(v4.x, v4.y);
        ctx.fill();
        
        if (debug.drawEdgeNormals) {
            for (let e of this.edges) drawEdgeNormal(e);
        }
        if (debug.drawVertices) {
            ctx.fillStyle = "#44aaff";
            for (let i = 0; i < this.vertices.length; i++) {
                const v = this.vertices[i];
                ctx.beginPath();
                ctx.arc(v.x, v.y, 2, 0, tau);
                ctx.fill();
                ctx.fillText(String(i+1), v.x + 6, v.y + 4);
            }
        }
    }
    
}


////// POINTER //////

const ptr = {
    isDown: false,
    x: 0,
    y: 0,
    sx: 0, // start
    sy: 0,
    px: 0, // previous
    py: 0,
    dx: 0, // delta
    dy: 0,
    ox: 0, // offset
    oy: 0
};

function handleDown(e) {
    ptr.isDown = true;
    if ("touches" in e){
        ptr.x = e.touches[0].clientX;
        ptr.y = e.touches[0].clientY;
    } else {
        ptr.x = e.clientX;
        ptr.y = e.clientY;
    }
    ptr.sx = ptr.x;
    ptr.sy = ptr.y;
    ptr.px = ptr.x;
    ptr.py = ptr.y;
    
    if (!debug.drag) drawingWall = new wall(ptr.x, ptr.y);
    else {
        ball.x = ptr.x;
        ball.y = ptr.y;
    }
}

function handleMove(e) {
    if ("touches" in e) {
        ptr.x = e.touches[0].clientX;
        ptr.y = e.touches[0].clientY;
    } else if (ptr.isDown) {
        ptr.x = e.clientX;
        ptr.y = e.clientY;
    } else return;
    
    if (drawingWall) {
        drawingWall.end.x = ptr.x;
        drawingWall.end.y = ptr.y;
    }
}

function handleUp(e) {
    ptr.isDown = false;
    ptr.dx = 0;
    ptr.dy = 0;
    
    if (drawingWall) {
        const dist = (ptr.x - ptr.sx) ** 2 + (ptr.y - ptr.sy) ** 2;
        if (dist > wallThickness ** 2) drawingWall.place();
    }
    drawingWall = null;
    
    if (debug.drag) {
        ball.dx = 0;
        ball.dy = 0;
    }
}


////// CANVAS + DRAWING //////

function setCanvasSize() {
    const dpr = window.devicePixelRatio;
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    ctx.scale(dpr, dpr);
}

function drawText(text) {
    const margin = 12;
    const lineSpace = 15;
    ctx.lineWidth = 2;
    ctx.fillStyle = "#000000";
    
    const lines = text.split("\n");
    const y = h - margin - ((lines.length - 1) * lineSpace);
    
    for (let l = 0; l < lines.length; l++) {
        const st = lines[l];
        const ly = y + lineSpace * l;
        ctx.fillText(st, margin, ly);
    }
}



function drawEdgeNormal(edge) {
    const len = 15;
    const arrowW = 3;
    const arrowH = 5;
    
    // start + end verts
    const a = edge.v[0];
    const b = edge.v[1];
    const d = b.subtract(a);
    const start = a.add(d.scale(0.5));
    const end = start.add(edge.normal.scale(len));
    
    // arrow verts
    const p1 = start.add(edge.normal.scale(len + arrowH));
    const translate = edge.normal.getNormal().scale(arrowW);
    const p2 = end.subtract(translate);
    const p3 = end.add(translate);
    
    ctx.strokeStyle = "#dd3333";
    ctx.fillStyle = "#dd3333";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
    
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.lineTo(p3.x, p3.y);
    ctx.fill();
}


////// ENGINE //////

function update(ts) {
    log(`TS: [${ts}]`);
    debug.text = "";
    debug.verts = [];
    debug.lines = [];
    
    // pointer
    if (ptr.isDown) {
        ptr.dx = Math.cos(ptr.x - ptr.px);
        ptr.dy = Math.sin(ptr.y - ptr.py);
        debug.text = `${ptr.dx}\n${ptr.dy}`;
        ptr.px = ptr.x;
        ptr.py = ptr.y;
    }
    
    ball.update();
}

function draw(inter) {
    ctx.fillStyle = "#ffffff30";
    ctx.clearRect(0, 0, w, h);
    for (let wall of walls) wall.draw();
    ball.draw();
    
    if (ptr.isDown) {
        ctx.strokeStyle = "#b0000066";
        ctx.lineWidth = wallThickness;
        ctx.beginPath();
        ctx.moveTo(ptr.sx, ptr.sy);
        ctx.lineTo(ptr.x, ptr.y);
        ctx.stroke();
    }
    
    // debug
    if (debug.drawText) drawText(debug.text);
    if (debug.verts.length) {
        ctx.fillStyle = "#ff3300";
        for (let v of debug.verts) {
            ctx.beginPath();
            ctx.arc(v[0], v[1], 3, 0, tau);
            ctx.fill();
        }
    }
    if (debug.lines.length) {
        ctx.strokeStyle = "#ff4400";
        ctx.lineWidth = 1;
        for (let l of debug.lines) {
            ctx.beginPath();
            ctx.moveTo(l[0], l[1]);
            ctx.lineTo(l[2], l[3]);
            ctx.stroke();
        }
    }
}

function run(ts) {
    clock.acc += ts - clock.pts;
    clock.pts = ts;
    
    while (clock.acc >= targetFT) {
        update(ts);
        clock.acc -= targetFT;
        if (pause) test++;
    }
    draw(clock.acc / targetFT);
    
    if (test < 1)
    requestAnimationFrame(run);
}


////// INIT //////

setCanvasSize();

ctx.font = "700 13px sans-serif";

ball.dx = rndNeg(Math.random());
ball.dy = rndNeg(Math.sqrt(1 - ball.dx * ball.dx));
ball.x = rndBetween(40, w - 40);
ball.y = rndBetween(40, h - 40);

// Events

window.addEventListener("resize", setCanvasSize);
canvas.addEventListener("touchstart", handleDown);
canvas.addEventListener("touchmove", handleMove);
canvas.addEventListener("touchend", handleUp);
canvas.addEventListener("pointerdown", handleDown);
canvas.addEventListener("pointermove", handleMove);
canvas.addEventListener("pointerup", handleUp);


////// RUN //////

test1();

requestAnimationFrame(ts => clock.pts = ts);
requestAnimationFrame(run);


////// TESTS //////

function test1() {
    walls.length = 0;
    const w = new wall(150, 300);
    w.ex = 300;
    w.ey = 160;
    w.end.x = 300;
    w.end.y = 160;
    w.place();
    ball.x = pause ? 200 : 170;
    ball.y = 225;
    ball.dx = 1.5;
    ball.dy = 0;
}