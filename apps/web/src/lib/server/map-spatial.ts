import 'server-only';
import type {MapArea,MapModel} from './map-data';
export type XY=[number,number];
export type BoundarySegment=readonly [XY,XY];
function distanceToSegment([x,z]:XY,[a,b]:BoundarySegment):number {
  const dx=b[0]-a[0],dz=b[1]-a[1],length=dx*dx+dz*dz;
  const t=length ? Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/length)) : 0;
  return Math.hypot(x-a[0]-t*dx,z-a[1]-t*dz);
}
export function distanceToRing(point:XY,ring:XY[]):number {
  let best=Infinity;
  for(let i=0;i<ring.length;i++){
    best=Math.min(best,distanceToSegment(point,[ring[i],ring[(i+1)%ring.length]]));
  }
  return best;
}
function rayInsideRing(point:XY,ring:XY[]):boolean {
  const [x,z]=point; let inside=false;
  for(let i=0;i<ring.length;i++){
    const [ax,az]=ring[i],[bx,bz]=ring[(i+1)%ring.length];
    if((az>z)!==(bz>z) && x<(bx-ax)*(z-az)/(bz-az)+ax) inside=!inside;
  }
  return inside;
}
export function insideRing(point:XY,ring:XY[]):boolean {
  return ring.length>=3 && (distanceToRing(point,ring)<1e-7 || rayInsideRing(point,ring));
}
const difference=([ax,ay]:XY,[bx,by]:XY):XY=>[ax-bx,ay-by];
const cross=([ax,ay]:XY,[bx,by]:XY):number=>ax*by-ay*bx;
const interpolate=([a,b]:BoundarySegment,t:number):XY=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
function segmentCuts(segment:BoundarySegment,other:BoundarySegment):number[] {
  const [a,b]=segment,[c,d]=other,r=difference(b,a),s=difference(d,c),offset=difference(c,a);
  const denominator=cross(r,s),tolerance=Number.EPSILON*64*Math.max(1,Math.hypot(...r)*Math.hypot(...s));
  if(Math.abs(denominator)>tolerance){
    const t=cross(offset,s)/denominator,u=cross(offset,r)/denominator;
    return t>=0 && t<=1 && u>=0 && u<=1?[t]:[];
  }
  if(Math.abs(cross(offset,r))>tolerance)return [];
  const length=r[0]*r[0]+r[1]*r[1];
  if(!length)return [];
  return [c,d].map(p=>((p[0]-a[0])*r[0]+(p[1]-a[1])*r[1])/length).filter(t=>t>=0 && t<=1);
}
/**
 * Boundary of union(rings) intersect union(parentRings), calculated once per
 * query. Split edges at all crossings and collinear overlap endpoints. Between
 * crossings membership is constant on either side; keep only edges separating
 * inside from outside. This removes overlapping/adjoining polygon seams and
 * portions of either boundary outside the other footprint.
 */
export function intersectionBoundary(rings:XY[][],parentRings?:XY[][]):BoundarySegment[] {
  const allRings=parentRings?[...rings,...parentRings]:rings;
  const edges:BoundarySegment[]=allRings.flatMap(ring=>ring.map((point,index)=>[point,ring[(index+1)%ring.length]] as BoundarySegment));
  const contains=(point:XY,inclusive=false)=>{
    const test=inclusive?insideRing:rayInsideRing;
    return rings.some(ring=>test(point,ring)) && (!parentRings || parentRings.some(ring=>test(point,ring)));
  };
  const boundary:BoundarySegment[]=[],vertices:XY[]=[],attachedToInterior:XY[]=[];
  for(const edge of edges){
    const cuts=[0,1,...edges.flatMap(other=>segmentCuts(edge,other))].sort((a,b)=>a-b);
    const unique=cuts.filter((cut,index)=>index===0 || cut-cuts[index-1]>1e-12);
    for(let i=1;i<unique.length;i++){
      const a=interpolate(edge,unique[i-1]),b=interpolate(edge,unique[i]),mid=interpolate([a,b],.5);
      const dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);
      if(!length)continue;
      const roundoff=Number.EPSILON*64*Math.max(1,Math.abs(mid[0]),Math.abs(mid[1]));
      // Stay closer to this segment than any noncoincident edge, including very
      // narrow polygon parts. Strict ray tests avoid the inclusive edge epsilon.
      let clearance=Infinity;
      for(const other of edges){const distance=distanceToSegment(mid,other);if(distance>roundoff)clearance=Math.min(clearance,distance);}
      const step=Math.min(length*1e-6,clearance/4,1e-4),nx=-dy/length*step,ny=dx/length*step;
      const left=contains([mid[0]+nx,mid[1]+ny]),right=contains([mid[0]-nx,mid[1]-ny]);
      vertices.push(a,b);
      if(left || right)attachedToInterior.push(a,b);
      if(left!==right || (!left && !right && contains(mid,true)))boundary.push([a,b]);
    }
  }
  // Closed polygons can meet only at a corner. Preserve that zero-length
  // boundary, while excluding vertices of internal union seams.
  for(const point of vertices){
    if(contains(point,true) && !attachedToInterior.some(other=>Math.hypot(point[0]-other[0],point[1]-other[1])<1e-7)
      && distanceToIntersectionBoundary(point,boundary)>=1e-7)boundary.push([point,point]);
  }
  return boundary;
}
export function distanceToIntersectionBoundary(point:XY,boundary:BoundarySegment[]):number {
  let best=Infinity;
  for(const segment of boundary)best=Math.min(best,distanceToSegment(point,segment));
  return best;
}
export function polygonMatch(xz:XY,polygon:MapArea['polygons'][number],y:number|null=null):boolean {
  if(!insideRing(xz,polygon.ring)) return false;
  const [lo,hi]=polygon.height??[null,null];
  return y===null || !((lo!==null && y<lo)||(hi!==null && y>hi));
}
export const mercator=(lat:number):number => Math.asinh(Math.tan(lat*Math.PI/180))*180/Math.PI;
export function worldPoint(lng:number,lat:number,matrix:MapModel['matrix']):XY {
  const [[a,b],[c,d],[tx,ty]]=matrix,u=lng-tx,v=mercator(lat)-ty,det=a*d-b*c;
  return [(u*d-v*c)/det,(-u*b+v*a)/det];
}
/** Canvas uses centered AppSample Mercator with its Y axis pointing down. */
export function projectPoint([x,z]:XY,matrix:MapModel['matrix']):XY {
  return [x*matrix[0][0]+z*matrix[1][0]+matrix[2][0],-(x*matrix[0][1]+z*matrix[1][1]+matrix[2][1])];
}
