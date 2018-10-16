/**
 * @see        {https://docs.screeps.com/api/#PathFinder-CostMatrix}
 * CostMatrix serialization and deserialization alternatives
 */

/**
 * Holds all cost values being utilized by serialized CostMatrix instances
 * stored in global scope
 *
 * @constant
 * @type       {number[]}
 */
const OFFSETS = [];

/**
 * Used as an additional offset during compression and decompression of
 * CostMatrix instances
 *
 * @type       {number}
 */
const SPACER = 22

/**
 * Used as marker to indicate offset has been stored along with serialized
 * matrix
 *
 * @constant
 * @type       {string}
 */
const TRIGGER = String.fromCharCode(65355);

Object.defineProperty(PathFinder.CostMatrix.prototype, 'costMap', {
    /**
     * Gets values that reflect modified CostMatrix positions and their
     * associated cost
     *
     * @return     {number[]}  this._bits indices with an offset added that
     *                         reflects associated cost
     */
    get: function() {
        if (!this._costMap) {
            this._costMap = [];
        }
        return this._costMap;
    },
});

/**
 * Sets the cost at the provided (x,y) position and updates this.costMap with a
 * value that reflects the modified position cost and the index it is found at
 * in this._bits
 *
 * Use this method instead of this.set() only when using this.pack() for data
 * serialization *
 * @extends {PathFinder.CostMatrix}
 *
 * @param      {number}  x       x position
 * @param      {number}  y       y position
 * @param      {number}  cost    PathFinding cost position will be set to
 */
PathFinder.CostMatrix.prototype.update = function(x = 0, y = 0, cost = 0) {
    const index = x * 50 + y;
    this._bits[index] = Math.min(Math.max(0, cost), 255);

    let offset = OFFSETS.indexOf(cost);
    if (offset === -1) {
        offset = OFFSETS.push(cost) - 1;
    }
    this.costMap.push(index * SPACER + offset);
};

/**
 * Translates CostMatrix to a string representing all positions in room where
 * the associated cost is > 0.
 * @extends {PathFinder.CostMatrix}
 *
 * @param      {boolean}  [freeze=false]  If true, the current state OFFSETS is
 *                                        serialized with the CostMatrix,
 *                                        allowing it to be stored in Memory and
 *                                        reused between global resets.
 *
 * @return     {string}  Serialized form of CostMatrix in its current state
 */
PathFinder.CostMatrix.prototype.pack = function(freeze = false) {
    let base = '';
    if (freeze) {
        base += TRIGGER + OFFSETS.length + String.fromCharCode(...OFFSETS);
    }

    if (this.costMap.length > 0) {
        return base + String.fromCharCode(...this.costMap);
    }

    const offsets = freeze ? OFFSETS.slice(0) : OFFSETS;
    for (let i = 0; i < this._bits.length; i++) {
        let cost = this._bits[i];
        if (cost === 0) {
            continue;
        }
        let offset = offsets.indexOf(cost);
        if (offset === -1) {
            offset = offsets.push(cost) - 1;
        }
        this.costMap.push(i * SPACER + offset);
    }
    return base + String.fromCharCode(...this.costMap);
};

/**
 * Converts an encoded CostMatrix string back to its original form
 *
 * @static
 * @param      {string}  packed  A CostMatrix in its serialized, encoded form
 *
 * @return     {PathFinder.CostMatrix}  CostMatrix instance with position costs
 *                                      pulled from the encoded string
 */
PathFinder.CostMatrix.unpack = function(packed) {
    let [codec, start] = [OFFSETS, 0];
    if (packed[0] === TRIGGER) {
        codec = _deserializeOffset(packed);
        start += codec.length + 2;
    }
    const matrix = new PathFinder.CostMatrix();
    for (let i = start; i < packed.length; i++) {
        let value = packed.charCodeAt(i);
        matrix._bits[(value / SPACER) | 0] = codec[value % SPACER];
    }
    return matrix;
};

/**
 * Creates OFFSET array active at the time the packed matrix was created
 *
 * @param      {string}    packed  CostMatrix created by .pack(true)
 * @return     {number[]}  Array of numbers representing the state OFFSETS at
 *                         time of serialization
 */
function _deserializeOffset(packed) {
    const codecLength = parseInt(packed[1], 10);

    const offsets = [];
    for (let i = 2; i < 2 + codecLength; i++) {
        offsets.push(packed.charCodeAt(i));
    }
    return offsets;
}
