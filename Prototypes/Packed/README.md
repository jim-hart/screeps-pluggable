## Packed - CostMatrix Compression
Packed offers alternatives to the native `.serialize()` and `.deserialize()` methods provided by the screeps API.

The benefits of Packed over native methods are:
  * Up to 17x faster compression
  * Up to 10x faster decompression
  * Output strings that are 6x smaller on average

The limitations of Packed over native methods are:
  * Reduced cost value distribution
  * Global caching required for best performance

For additional information, please see the [Benefits](#benefits) and [Limitations](#limitations) sections

### Usage
_Packed_ extends `PathFinder.CostMatrix` with three new methods similar to existing ones

#### update <=> [set](https://docs.screeps.com/api/#PathFinder.CostMatrix.set)
```node
function addStructures(room, matrix) {
  const structures = room.find(FIND_STRUCTURES);

  for (let i = 0; i < structures.length; i++) {
    let [cost, obj] = [0, structures[i]];
    if (obj.structureType === STRUCTURE_ROAD) {
        cost = 1;
    } else if (obj.structureType === STRUCTURE_RAMPART) {
        cost = obj.my || obj.isPublic ? 0 : 255;
    } else if (obj.structureType === STRUCTURE_CONTAINER) {
        cost = 10;
    } else {
        cost = 255;
    }

    //you can still use .set(), but serialization won't be as fast
    if (cost > matrix.get(obj.pos.x, obj.pos.y)) {
        matrix.update(obj.pos.x, obj.pos.y, cost);
    }
  }
}
```

#### pack => [serialize](https://docs.screeps.com/api/#PathFinder.CostMatrix.serialize)
```node
const matrix = new PathFinder.CostMatrix();
addStructures(Game.rooms.E1N1);

//if caching in global
const serializedToGlobal = matrix.pack();

//if storing in memory, include true as an argument
const serializedToMemory = matrix.pack(true);
```

#### unpack => [deserialize](https://docs.screeps.com/api/#PathFinder.CostMatrix.CostMatrix-deserialize)
```node
//...continued from .pack() example

//Unpack compressed matrices just like you would with .deserialize()
const unpackedFromGlobal = PathFinder.CostMatrix.unpack(serializedToGlobal);

//No special arg needed for unpacking instances cached to memory
const unpackedFromMemory = PathFinder.CostMatrix.unpack(serializedToMemory);
```

_note:_ you can still call `.pack()` on CostMatrix instances populated by `.set()` instead of `.update()`.  Doing so will result in a slower serialization process, however.

### Benefits
A PathFinder.CostMatrix instance, internally, is represented by a [Uint8Array](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Uint8Array) when uncompressed, and a [Uint32Array](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Uint32Array) when compressed.  While the use of TypedArray objects allows for fast access and simple compression/decompression methods, the size of compressed CostMatrix instances presents a problem for long term storage.

Although a small number of CostMatrix objects won't pose a problem, in `Memory`, a single compressed CostMatrix instance takes up over 1KB of space.  As your area of control increases, so does `Game.rooms` and the number of CostMatrix instances needed to represent those rooms. Because of the 2MB Memory cap, storing CostMatrix instances in global becomes a more practical option.  While `RawMemory` segments are an option, the 1 tick delay between request and access time presents its own host of problems.

`Packed` addresses these issues by only compressing positions where the associated cost value is greater than 0, and has been explicitly modified. By ignoring the vast majority of room tiles that typically default to a terrain cost, compression speed improves and the resulting output is significantly smaller.  For example, an empty CostMatrix compressed using native methods, and serialized using `JSON.stringify()`, outputs a string 1251 characters long.

By contrast, a CostMatrix representing 300 room positions, all with a cost > 0, results in an output string only 300 characters long when compressed with `.pack()`.  At most, only an additional 25 characters are needed to make the output string suitable for long term storage in `Memory`.  Ignoring the codex needed for long term storage, the resulting output of `.pack()` always equals the amount of room positions explicitly modified to have a cost greater than 0.

### Limitations
While While `Packed` has many benefits, it makes some fundamental assumptions about how you use and construct your CostMatrix objects.  I want to stress that although native compression methods have there own set of limitations, *those limitations result in improved stability and consistency*.  I don't want this module to come across as a criticism against native methods; they are perfect for a public API.

The primary limitation of `Packed` is a hard cap on the variance of position costs that can be reflected across *all* globally cached CostMatrix instances.  For example, take

  - roads     : 1
  - containers: 10
  - obstacles : 255

This CostMatrix uses 3 unique cost values, `1` for roads, `10` for containers, and `255` for anything considered an obstacle.  If this were my only cached CostMatrix instance, I'd have a total of `3` unique cost values in circulation.  In order to keep compression/decompressions times fast, at most, only *22* different cost values can be reflected in CostMatrix instances cached in global scope.

Compressed instances stored in `Memory` don't add to this global limit unless they are decompressed and modified with `.update()`.  They can be safely decompressed, modified with `.set()`, and compressed again using the `freeze` option.  Note that although this chain of actions won't add to the global limit, the matrix itself is still restricted by the hard cap of 22.  Because CostMatrix objects serialized for storage in `Memory` will likely reflect `global` in a different state, the cost variance during initial serialization combined with the currently active cost variance may exceed this limit.

If you are scratching your head right now and have no idea what I'm talking about, its likely none of this applies to you.  These prototype extensions were intended for standard PathFinder operations and not complex CostMatrix creation targeted at specific goals like room offense/defense.  At most, I typically have 6 different cost values active on average.  If you need more than 22, but still want to use these methods, use `.set()` to avoid adding additional costs and don't serialize the result with `.pack()`.

Also note that you will see performance improvements regardless of where you store your serialized CostMatrix instances, you will get better performance compressing them to, and decompressing them from a global cache versus one found in `Memory`.
