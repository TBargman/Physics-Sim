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
const friction = 1;
const gravity = 5;
const restitution = 1;
const screenWalls = "wrap"; // bounce/wrap

const walls = [];
let drawingWall = null;
let wallIdCount = 0;
const wallThickness = 15;

let test = 0;
let pause = false;
let logging = false;
const debug = {
    drawText: true,
    drawVertices: false,
    drawEdgeNormals: false,
    drawCollisions: false,
    text: "",
    verts: [],
    lines: [],
    arrows: []
};


//////////////////////////////////////////////////
////////////////////// BALL //////////////////////

const ball = {
    colliding: false,
    dragging: false,
    radius: 25,
    pos: new vec2(0, 0),
    prev: new vec2(0, 0), // previous position
    dir: new vec2(0, 0),
    delta: new vec2(0, 0),
    speed: 4,
    
    get x() { return this.pos.x; },
    set x(n) { this.pos.x = n; },
    get y() { return this.pos.y; },
    set y(n) { this.pos.y = n; },
    
    project: function(vec) {
        const p = this.x * vec.x + this.y * vec.y;
        const min = p - this.radius;
        const max = p + this.radius;
        return [min, max];
    },
    update: function() {
        
        // move, handle screen boundaries
        this.prev = this.pos.copy();
        if (screenWalls === "wrap") {
            if (this.x + this.radius < -1)    this.x = this.radius + w;
            if (this.y + this.radius < -1)    this.y = this.radius + h;
            if (this.x - this.radius > w + 1) this.x = -this.radius;
            if (this.y - this.radius > h + 1) this.y = -this.radius;
        } else if (screenWalls === "bounce") {
            if (this.x - this.radius < 0) {
                this.x = this.radius;
                this.dir.x = -this.dir.x;
            }
            if (this.y - this.radius < 0) {
                this.y = this.radius;
                this.dir.y = -this.dir.y;
            }
            if (this.x + this.radius > w) {
                this.x = w - this.radius;
                this.dir.x = -this.dir.x;
            }
            if (this.y + this.radius > h) {
                this.y = h - this.radius;
                this.dir.y = -this.dir.y;
            }
        }
        
        // calculate delta
        if (ptr.isDown && this.dragging) {
            this.x = ptr.x - ptr.ox;
            this.y = ptr.y - ptr.oy;
        } else {
            if (Math.abs(this.speed) < 0.02) this.speed = 0;
            else this.speed *= friction;
            const delta = this.dir.scale(this.speed);
            
            // apply
            this.pos = this.pos.add(delta);
        }
        
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
                
                // 4. Resolve
                let collisionVec = minOverlapAxis;
                // make sure collisionVec is correct dir
                const dir = w.center.subtract(this.pos);
                if (dir.dot(collisionVec) < 0) collisionVec = collisionVec.flipped();
                
                const res = collisionVec.scale(minOverlap);
                this.pos = this.pos.subtract(res);
                if (debug.drawCollisions) debug.arrows.push([this.pos, collisionVec]);
                
                // 5. Reflect
                this.dir = this.dir.reflect(collisionVec.scale(restitution));
                
                // collide with only one wall:
                break;
            } else {
                this.colliding = false;
            }
        }
        // check collisions
        // separating axis theorem baybeeeee
    },
    draw: function(inter) {
        // transform/translate
        const tf = inter ?
            this.pos.subtract(this.prev).scale(inter).add(this.prev) :
            this.pos;
        
        if (debug.drawCollisions && this.colliding) {
            ctx.fillStyle = "#ff2f2f44";
            ctx.strokeStyle = "#c1000077";
        } else {
            ctx.fillStyle = "#30cd9f";
            ctx.strokeStyle = "#0a7c67";
        }
        ctx.lineWidth = 6; // increases radius btw
        ctx.beginPath();
        ctx.arc(tf.x, tf.y, this.radius - 3, 0, tau);
        ctx.stroke();
        ctx.fill();
        if (debug.drawVertices) {
            ctx.fillStyle = this.colliding ? "#c1000077" : "#0a7c67";
            ctx.beginPath();
            ctx.arc(tf.x, tf.y, 2, 0, tau);
            ctx.fill();
        }
    }
};


////////////////////////////////////////////////
////////////////// WALL CLASS //////////////////

class wall {
    constructor(startx, starty) {
        this.id = null;
        this.selected = false;
        this.start = new vec2(startx, starty);
        this.end = new vec2(startx, starty);
        this.vertices = [];
        this.edges = [];
        this.center = null;
    }
    place() {
        wallIdCount++;
        this.id = wallIdCount;
        
        // get vertices from start/end points
        const normal = this.end.subtract(this.start).normalized().getNormal();
        const translate = normal.scale(wallThickness / 2);
        
        // set vertices
        this.vertices = [
            this.start.add(translate),
            this.end.add(translate),
            this.end.subtract(translate),
            this.start.subtract(translate)
        ];
        
        // set edges + normals
        for (let i = 0; i < 4; i++) {
            const a = this.vertices[i];
            const b = this.vertices[(i + 1) % 4];
            const d = new vec2(b.x - a.x, b.y - a.y);
            const n = d.normalized().getNormal();
            this.edges.push({id: i+1, v: [a, b], normal: n});
        }
        
        // set center point
        let sumX = 0;
        let sumY = 0;
        for (let v of this.vertices) {
            sumX += v.x;
            sumY += v.y;
        }
        sumX /= 4;
        sumY /= 4;
        this.center = new vec2(sumX, sumY);
        
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
            ctx.beginPath();
            ctx.arc(this.center.x, this.center.y, 2, 0, tau);
            ctx.fill();
        }
    }
    
}


/////////////////////////////////////////////////
//////////////////// POINTER ////////////////////

const ptr = {
    isDown: false,
    speed: 0,
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
    
    const bdx = ptr.x - ball.x;
    const bdy = ptr.y - ball.y;
    const ballDist = bdx * bdx + bdy * bdy;
    if (ballDist < ball.radius * ball.radius) {
        ball.dragging = true;
        ptr.ox = bdx;
        ptr.oy = bdy;
    } else {
        drawingWall = new wall(ptr.x, ptr.y);
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
    if (ball.dragging) {
        ball.dir.x = ptr.dx;
        ball.dir.y = ptr.dy;
        ball.speed = ptr.speed;
        ball.dragging = false;
    } else if (drawingWall) {
        const dist = (ptr.x - ptr.sx) ** 2 + (ptr.y - ptr.sy) ** 2;
        if (dist > wallThickness ** 2) drawingWall.place();
    }
    
    drawingWall = null;
    ptr.dx = 0;
    ptr.dy = 0;
    ptr.speed = 0;
    ptr.isDown = false;
}


//////////////////////////////////////////////////
//////////////// CANVAS + DRAWING ////////////////

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
    // draws in bottom-left corner
    const margin = 12;
    const lineSpace = 15;
    ctx.lineWidth = 2;
    ctx.fillStyle = "#000000";
    
    const lines = text.split("\n");
    const starty = h - margin - ((lines.length - 1) * lineSpace);
    
    for (let l = 0; l < lines.length; l++) {
        const st = lines[l];
        const ly = starty + lineSpace * l;
        ctx.fillText(st, margin, ly);
    }
}

function drawArrow(start, dir) {
    // dir must be normalized
    const len = 15;
    const arrowW = 3;
    const arrowH = 5;
    
    // get end vertex
    const end = start.add(dir.scale(len));
    
    // arrow verts
    const v1 = end.add(dir.scale(arrowH));
    const translate = dir.getNormal().scale(arrowW);
    const v2 = end.subtract(translate);
    const v3 = end.add(translate);
    
    ctx.strokeStyle = "#dd3333";
    ctx.fillStyle = "#dd3333";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
    
    ctx.beginPath();
    ctx.moveTo(v1.x, v1.y);
    ctx.lineTo(v2.x, v2.y);
    ctx.lineTo(v3.x, v3.y);
    ctx.fill();
}

function drawEdgeNormal(edge) {
    // start at edge center
    const a = edge.v[0];
    const b = edge.v[1];
    const d = b.subtract(a);
    const start = a.add(d.scale(0.5));
    drawArrow(start, edge.normal);
}


//////////////////////////////////////////////////
///////////////////// ENGINE /////////////////////

function update(ts) {
    log(`TS: [${ts}]`);
    debug.text = "";
    debug.verts = [];
    debug.lines = [];
    debug.arrows = [];
    
    // pointer
    if (ptr.isDown) {
        // track direction
        const dx = ptr.x - ptr.px;
        const dy = ptr.y - ptr.py;
        const d = Math.sqrt(dx * dx + dy * dy);
        const nx = dx / d;
        const ny = dy / d;
        ptr.speed = d;
        ptr.dx = isNaN(nx) ? 0 : nx;
        ptr.dy = isNaN(ny) ? 0 : ny;
        
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
    
    if (ptr.isDown && !ball.dragging) {
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
    if (debug.arrows.length) {
        for (let a of debug.arrows) {
            drawArrow(a[0], a[1]);
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


//////////////////////////////////////////////////
////////////////////// INIT //////////////////////

setCanvasSize();

ctx.font = "700 13px sans-serif";

ball.dir.x = rndNeg(Math.random());
ball.dir.y = rndNeg(Math.sqrt(1 - ball.dir.x * ball.dir.x));
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


/////////////////////////////////////////////////
////////////////////// RUN //////////////////////

//test1();

requestAnimationFrame(ts => clock.pts = ts);
requestAnimationFrame(run);


/////////////////////////////////////////////////
//////////////////// TESTS //////////////////////

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
    ball.delta.x = 1.5;
    ball.delta.y = 0;
}