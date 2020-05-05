import Check from "../Core/Check.js";
import clone from "../Core/clone.js";
import ComponentDatatype from "../Core/ComponentDatatype.js";
import defaultValue from "../Core/defaultValue.js";
import defined from "../Core/defined.js";
import destroyObject from "../Core/destroyObject.js";
import getBinaryAccessor from "./getBinaryAccessor.js";
import GltfFeatureTablePropertyType from "./GltfFeatureTablePropertyType.js";
import when from "../ThirdParty/when.js";

/**
 * A feature table accessor property.
 * <p>
 * Implements the {@link GltfFeatureTableProperty} interface.
 * </p>
 *
 * @param {Object} options Object with the following properties:
 * @param {Object} options.gltf The glTF JSON object.
 * @param {String} options.name The name of the property.
 * @param {Object} options.property The feature property JSON object from the glTF.
 * @param {GltfFeatureMetadataCache} options.cache The feature metadata cache.
 *
 * @alias GltfFeatureTableAccessorProperty
 * @constructor
 *
 * @private
 */
function GltfFeatureTableAccessorProperty(options) {
  options = defaultValue(options, defaultValue.EMPTY_OBJECT);
  var gltf = options.gltf;
  var name = options.name;
  var property = options.property;
  var cache = options.cache;

  //>>includeStart('debug', pragmas.debug);
  Check.typeOf.object("options.gltf", gltf);
  Check.typeOf.string("options.name", name);
  Check.typeOf.object("options.property", property);
  Check.typeOf.object("options.cache", cache);
  //>>includeEnd('debug');

  var accessorId = property.accessor;
  var accessor = gltf.accessors[accessorId];
  var type = accessor.type;
  var componentType = accessor.componentType;
  var count = accessor.count;
  var binaryAccessor = getBinaryAccessor(accessor);
  var normalized = isNormalized(accessor.normalized, componentType);
  var buffer = getBuffer(gltf, accessor);
  var bufferSource = getBufferSource(gltf, accessor);
  var typedArray = getTypedArrayForAccessor(
    gltf,
    accessor,
    bufferSource,
    binaryAccessor
  );

  var readyPromise;

  // TODO: always try to read from the cache because you might want to hold onto a chunk before it gets deleted
  var that = this;
  if (!defined(typedArray) && defined(buffer)) {
    readyPromise = cache
      .getBuffer({
        buffer: buffer,
      })
      .then(function (cacheItem) {
        that._cacheItem = cacheItem;
        that._typedArray = getTypedArrayForAccessor(
          gltf,
          accessor,
          cacheItem.contents,
          binaryAccessor
        );
        return that;
      });
  } else {
    readyPromise = when.resolve(this);
  }

  // Clone so that this object doesn't hold on to a reference to the gltf JSON
  var extras = clone(property.extras, true);

  this._componentType = componentType;
  this._componentCount = binaryAccessor.componentsPerAttribute;
  this._accessorType = type;
  this._count = count;
  this._classType = binaryAccessor.classType;
  this._initializedWithZeros = !defined(accessor.bufferViewId);
  this._typedArray = typedArray;
  this._cache = cache;
  this._cacheItem = undefined;
  this._signed = isSignedComponentType(componentType);
  this._normalized = normalized;
  this._lowestValue = getLowestValue(componentType);
  this._maximumValue = getMaximumValue(componentType);
  this._name = name;
  this._semantic = property.semantic;
  this._type = GltfFeatureTablePropertyType.getTypeFromAccessorType(type);
  this._extras = extras;
  this._readyPromise = readyPromise;
}

Object.defineProperties(GltfFeatureTableAccessorProperty.prototype, {
  /**
   * @inheritdoc GltfFeatureTableProperty#name
   */
  name: {
    get: function () {
      return this._name;
    },
  },

  /**
   * @inheritdoc GltfFeatureTableProperty#name
   */
  semantic: {
    get: function () {
      return this._semantic;
    },
  },

  /**
   * @inheritdoc GltfFeatureTableProperty#name
   */
  type: {
    get: function () {
      return this._type;
    },
  },

  /**
   * @inheritdoc GltfFeatureTableProperty#name
   */
  extras: {
    get: function () {
      return this._extras;
    },
  },

  /**
   * @inheritdoc GltfFeatureTableProperty#name
   */
  readyPromise: {
    get: function () {
      return this._readyPromise;
    },
  },
});

function getBuffer(gltf, accessor) {
  var bufferViewId = accessor.bufferView;
  if (!defined(bufferViewId)) {
    return undefined;
  }

  var bufferView = gltf.bufferViews[bufferViewId];
  var bufferId = bufferView.buffer;
  var buffer = gltf.buffers[bufferId];

  return buffer;
}

function getBufferSource(gltf, accessor) {
  var buffer = getBuffer(gltf, accessor);
  if (!defined(buffer)) {
    return undefined;
  }

  if (!defined(buffer.extras)) {
    return undefined;
  }

  var pipelineExtras = buffer.extras._pipeline;

  if (!defined(pipelineExtras) || !defined(pipelineExtras.source)) {
    return undefined;
  }

  return pipelineExtras.source;
}

function getTypedArrayForAccessor(
  gltf,
  accessor,
  bufferSource,
  binaryAccessor
) {
  if (!defined(bufferSource) || !defined(accessor.bufferView)) {
    return undefined;
  }

  var bufferView = gltf.bufferViews[accessor.bufferView];
  var byteOffset =
    bufferSource.byteOffset + bufferView.byteOffset + accessor.byteOffset;

  // TODO: probably want to do a deep copy of the buffer if the buffer is referenced by other things in the glTF because otherwise the buffer won't get freed
  return binaryAccessor.createArrayBufferView(
    bufferSource,
    byteOffset,
    accessor.count
  );
}

function isSignedComponentType(componentType) {
  return (
    componentType === ComponentDatatype.BYTE ||
    componentType === ComponentDatatype.SHORT ||
    componentType === ComponentDatatype.INT
  );
}

function isUnsignedComponentType(componentType) {
  return (
    componentType === ComponentDatatype.UNSIGNED_BYTE ||
    componentType === ComponentDatatype.UNSIGNED_SHORT ||
    componentType === ComponentDatatype.UNSIGNED_INT
  );
}

function isNormalized(normalized, componentType) {
  return (
    normalized &&
    (isSignedComponentType(componentType) ||
      isUnsignedComponentType(componentType))
  );
}

function getMaximumValue(componentType) {
  // See https://www.khronos.org/opengl/wiki/Normalized_Integer#Signed
  var bitDepth = ComponentDatatype.getSizeInBytes(componentType);
  if (isSignedComponentType(componentType)) {
    return Math.pow(2, bitDepth - 1) - 1;
  } else if (isUnsignedComponentType(componentType)) {
    return Math.pow(2, bitDepth) - 1;
  }
  return Number.POSITIVE_INFINITY;
}

function getLowestValue(componentType) {
  // See https://www.khronos.org/opengl/wiki/Normalized_Integer#Signed
  var bitDepth = ComponentDatatype.getSizeInBytes(componentType);
  if (isSignedComponentType(componentType)) {
    return -Math.pow(2, bitDepth - 1);
  } else if (isUnsignedComponentType(componentType)) {
    return 0;
  }
  return Number.NEGATIVE_INFINITY;
}

function decodeValue(property, value) {
  if (!property._normalized) {
    return value;
  }

  if (property._signed) {
    return Math.max(value / property._maximumValue, -1.0);
  }

  return value / property._maximumValue;
}

function encodeValue(property, value) {
  if (!property._normalized) {
    return value;
  }

  return Math.round(value * property._maximumValue);
}

var packedArray = new Array(16);

/**
 * Get the property value of a feature.
 * <p>
 * If the property is normalized, integer data values will be normalized to [0, 1]
 * for unsigned types or [-1, 1] for signed types before being returned.
 * </p>
 *
 * @param {Number} featureId The feature ID.
 * @param {Cartesian2|Cartesian3|Cartesian4|Matrix2|Matrix3|Matrix4} [result] The object into which to store
 * the result for vector and matrix properties. The <code>result</code> argument is ignored for scalar properties.
 * @returns {Cartesian2|Cartesian3|Cartesian4|Matrix2|Matrix3|Matrix4|Number} The value. The type of the returned value corresponds with the accessor's <code>type</code>.
 * For vector and matrix properties the returned object is the modified result parameter or a new instance if one was not provided
 * and may be a {@link Cartesian2}, {@link Cartesian3}, {@link Cartesian4}, {@link Matrix2}, {@link Matrix3}, or {@link Matrix4}.
 * For scalar properties a number is returned.
 *
 * @private
 */
GltfFeatureTableAccessorProperty.prototype.getValue = function (
  featureId,
  result
) {
  var componentCount = this._componentCount;
  var classType = this._classType;
  var typedArray = this._typedArray;
  var normalized = this._normalized;
  var initializedWithZeros = this._initializedWithZeros;

  var startingIndex = featureId * componentCount;

  if (initializedWithZeros) {
    if (componentCount === 1) {
      return 0.0;
    }
    return classType.clone(classType.ZERO, result);
  }

  if (!defined(typedArray)) {
    return undefined;
  }

  if (componentCount === 1) {
    if (normalized) {
      return decodeValue(this, typedArray[startingIndex]);
    }
    return typedArray[startingIndex];
  }

  if (normalized) {
    var packedLength = classType.packedLength;
    for (var i = 0; i < packedLength; ++i) {
      packedArray[i] = decodeValue(this, typedArray[startingIndex + i]);
    }
    return classType.unpack(packedArray, 0, result);
  }

  return classType.unpack(typedArray, startingIndex, result);
};

/**
 * Set the property value of a feature.
 * <p>
 * If the property is normalized, integer data values should be normalized to [0, 1]
 * for unsigned types or [-1, 1] for signed types before being passed to <code>setPropertyValue</code>.
 * </p>
 *
 * @param {Number} featureId The feature ID.
 * @param {Cartesian2|Cartesian3|Cartesian4|Matrix2|Matrix3|Matrix4|Number} value The value. The type of the value corresponds with the property's <code>type</code>.
 * For vector and matrix properties the value may be a {@link Cartesian2}, {@link Cartesian3}, {@link Cartesian4}, {@link Matrix2}, {@link Matrix3}, or {@link Matrix4}.
 * For scalar properties the value is a number.
 *
 * @private
 */
GltfFeatureTableAccessorProperty.prototype.setValue = function (
  featureId,
  value
) {
  // TODO: needs to clone the typed array if it was referenced externally because it might have multiple references
  var componentType = this._componentType;
  var componentCount = this._componentCount;
  var count = this._count;
  var classType = this._classType;
  var typedArray = this._typedArray;
  var normalized = this._normalized;
  var initializedWithZeros = this._initializedWithZeros;

  var startingIndex = featureId * componentCount;

  if (initializedWithZeros) {
    // Initialize typed array on demand
    typedArray = ComponentDatatype.createTypedArray(
      componentType,
      componentCount * count
    );
    this._typedArray = typedArray;
    this._initializedWithZeros = false;
  }

  if (!defined(typedArray)) {
    return;
  }

  if (defined(this._cacheItem)) {
    // Clone on demand if modifying values that are in the cache
    typedArray = ComponentDatatype.createTypedArray(componentType, typedArray);
    this._typedArray = typedArray;
    this._cacheItem = undefined;
  }

  if (componentCount === 1) {
    if (normalized) {
      typedArray[startingIndex] = encodeValue(this, value);
      return;
    }
    typedArray[startingIndex] = value;
    return;
  }

  classType.pack(value, typedArray, startingIndex);

  if (normalized) {
    var packedLength = classType.packedLength;
    for (var i = 0; i < packedLength; ++i) {
      var index = startingIndex + i;
      typedArray[index] = encodeValue(this, typedArray[index]);
    }
  }
};

/**
 * @inheritdoc GltfFeatureTableProperty#name
 */
GltfFeatureTableAccessorProperty.prototype.isDestroyed = function () {
  return false;
};

/**
 * @inheritdoc GltfFeatureTableProperty#name
 */
GltfFeatureTableAccessorProperty.prototype.destroy = function () {
  var cache = this._cache;
  var cacheItem = this._cacheItem;

  if (defined(cacheItem)) {
    cache.releaseCacheItem({
      cacheItem: cacheItem,
    });
  }

  return destroyObject(this);
};

export default GltfFeatureTableAccessorProperty;
