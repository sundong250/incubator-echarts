/**
 * @file Data zoom model
 */
define(function(require) {

    var zrUtil = require('zrender/core/util');
    var env = require('zrender/core/env');
    var echarts = require('../../echarts');
    var modelUtil = require('../../util/model');
    var VisualMapping = require('../../visual/VisualMapping');
    var numberUtil = require('../../util/number');
    var asc = numberUtil.asc;
    var linearMap = numberUtil.linearMap;

    return echarts.extendComponentModel({

        type: 'dataRange',

        dependencies: ['series'],

        /**
         * [lowerBound, upperBound]
         *
         * @readOnly
         * @type {Array.<number>}
         */
        dataBound: [-Infinity, Infinity],

        /**
         * @readOnly
         * @type {Array.<string>}
         */
        stateList: ['inRange', 'outOfRange'],

        /**
         * @protected
         */
        defaultOption: {
            zlevel: 0,                  // 一级层叠
            z: 4,                       // 二级层叠
            show: true,

            min: 0,                     // 最小值，
            max: 200,                   // 最大值，
            dimension: null,

            inRange: null,             // 'color', 'colorH', 'colorS', 'colorL', 'colorA',
                                       // 'symbol', 'symbolSize'

            outOfRange: null,          // 'color', 'colorH', 'colorS', 'colorL', 'colorA',
                                       // 'symbol', 'symbolSize'

            orient: 'vertical',        // 布局方式，默认为垂直布局，可选为：
                                       // 'horizontal' ¦ 'vertical'
            x: 'left',                 // 水平安放位置，默认为全图左对齐，可选为：
                                       // 'center' ¦ 'left' ¦ 'right'
                                       // ¦ {number}（x坐标，单位px）
            y: 'bottom',               // 垂直安放位置，默认为全图底部，可选为：
                                       // 'top' ¦ 'bottom' ¦ 'center'
                                       // ¦ {number}（y坐标，单位px）
            inverse: false,

            seriesIndex: null,          // 所控制的series indices，默认所有有value的series.
            splitNumber: 5,            // 分割段数，默认为5，为0时为线性渐变 (contimous)
            backgroundColor: 'rgba(0,0,0,0)',
            borderColor: '#ccc',       // 值域边框颜色
            contentColor: '#5793f3',
            inactiveColor: '#aaa',
            borderWidth: 0,            // 值域边框线宽，单位px，默认为0（无边框）
            padding: 5,                // 值域内边距，单位px，默认各方向内边距为5，
                                       // 接受数组分别设定上右下左边距，同css
            textGap: 10,               //
            itemWidth: null,              // 值域图形宽度
            itemHeight: null,             // 值域图形高度
            precision: 0,              // 小数精度，默认为0，无小数点
            color: ['#006edd', '#e0ffff'],//颜色（deprecated，兼容ec2，对应数值由高到低）

            // formatter: null,
            text: null,                // 文本，如['高', '低']，兼容ec2，text[0]对应高值，text[1]对应低值
            textStyle: {
                color: '#333'          // 值域文字颜色
            }
        },

        /**
         * @protected
         */
        init: function (option, parentModel, ecModel) {
            /**
             * @private
             * @type {boolean}
             */
            this._autoSeriesIndex = false;

            /**
             * @private
             * @type {Array.<number>}
             */
            this._dataExtent;

            /**
             * @readOnly
             */
            this.controllerVisuals = {};

            /**
             * @readOnly
             */
            this.targetVisuals = {};

            /**
             * @readOnly
             */
            this.textStyleModel;

            /**
             * [width, height]
             * @readOnly
             * @type {Array.<number>}
             */
            this.itemSize;

            this.mergeDefaultAndTheme(option, ecModel);
            this.mergeOption({}, true);
        },

        /**
         * @override
         */
        baseMergeOption: function (newOption) {
            var thisOption = this.option;

            newOption && zrUtil.merge(thisOption, newOption);

            if (newOption.text && zrUtil.isArray(newOption.text)) {
                thisOption.text = newOption.text.slice();
            }

            // FIXME
            // necessary?
            // Disable realtime view update if canvas is not supported.
            if (!env.canvasSupported) {
                thisOption.realtime = false;
            }

            this.textStyleModel = this.getModel('textStyle');

            this.resetItemSize();

            this.completeVisualOption();
        },

        /**
         * @param {number} valueStart Can be dataBound[0 or 1].
         * @param {number} valueEnd Can be null or dataBound[0 or 1].
         * @protected
         */
        formatValueText: function(valueStart, valueEnd) {
            var option = this.option;
            var precision = option.precision;
            var dataBound = this.dataBound;

            if (valueStart !== dataBound[0]) {
                valueStart = (+valueStart).toFixed(precision);
            }
            if (valueEnd != null && valueEnd !== dataBound[1]) {
                valueEnd = (+valueEnd).toFixed(precision);
            }

            var formatter = option.formatter;
            if (formatter) {
                if (zrUtil.isString(formatter)) {
                    return formatter
                        .replace('{value}', valueStart === dataBound[0] ? 'min' : valueStart)
                        .replace('{value2}', valueEnd === dataBound[1] ? 'max' : valueEnd);
                }
                else if (zrUtil.isFunction(formatter)) {
                    // FIXME
                    // this? echarts instance?
                    return formatter.call(null, valueStart, valueEnd);
                }
            }

            if (valueEnd == null) {
                return valueStart;
            }
            else {
                if (valueStart === dataBound[0]) {
                    return '< ' + valueEnd;
                }
                else if (valueEnd === dataBound[1]) {
                    return '> ' + valueStart;
                }
                else {
                    return valueStart + ' - ' + valueEnd;
                }
            }
        },

        /**
         * @protected
         */
        resetTargetSeries: function (newOption, isInit) {
            var thisOption = this.option;
            var autoSeriesIndex = this._autoSeriesIndex =
                (isInit ? thisOption : newOption).seriesIndex == null;
            thisOption.seriesIndex = autoSeriesIndex
                ? [] : modelUtil.normalizeToArray(thisOption.seriesIndex);

            autoSeriesIndex && this.ecModel.eachSeries(function (seriesModel, index) {
                var data = seriesModel.getData();
                // FIXME
                // 只考虑了list，还没有考虑map等。

                // FIXME
                // 这里可能应该这么判断：data.dimensions中有超出其所属coordSystem的量。
                if (data.type === 'list') {
                    thisOption.seriesIndex.push(index);
                }
            });
        },

        /**
         * @protected
         */
        resetExtent: function () {
            var thisOption = this.option;

            // Can not calculate data extent by data here.
            // Because series and data may be modified in processing stage.
            // So we do not support the feature "auto min/max".

            // var dataExtent = [Infinity, -Infinity];
            // zrUtil.each(thisOption.seriesIndex, function (seriesIndex) {
            //     var data = this.ecModel.getSeriesByIndex(seriesIndex).getData();
            //     // FIXME
            //     // 只考虑了list
            //     if (data.type === 'list') {
            //         var oneExtent = data.getDataExtent(this.getDataDimension(data));
            //         oneExtent[0] < dataExtent[0] && (dataExtent[0] = oneExtent[0]);
            //         oneExtent[1] > dataExtent[1] && (dataExtent[1] = oneExtent[1]);
            //     }
            // }, this);

            var extent = asc([thisOption.min, thisOption.max]);

            // extent[0] = Math.max(extent[0], dataExtent[0]);
            // extent[1] = Math.min(extent[1], dataExtent[1]);

            this._dataExtent = extent;


        },

        /**
         * @protected
         */
        getDataDimension: function (list) {
            var optDim = this.option.dimension;
            return optDim != null
                ? optDim
                : list.dimensions[list.dimensions.length - 1];
        },

        /**
         * @public
         * @override
         */
        getExtent: function () {
            return this._dataExtent.slice();
        },

        /**
         * @protected
         */
        resetVisual: function (fillVisualOption) {
            var dataExtent = this.getExtent();

            doReset.call(this, 'controller', this.controllerVisuals);
            doReset.call(this, 'target', this.targetVisuals);

            function doReset(baseAttr, visualMappings) {
                zrUtil.each(this.stateList, function (state) {
                    var mappings = visualMappings[state] || (visualMappings[state] = {});
                    var visaulOption = this.option[baseAttr][state] || {};
                    zrUtil.each(visaulOption, function (visualData, visualType) {
                        if (!VisualMapping.isValidType(visualType)) {
                            return;
                        }
                        var mappingOption = {
                            type: visualType,
                            dataExtent: dataExtent,
                            visual: visualData
                        };
                        fillVisualOption && fillVisualOption.call(this, mappingOption, state);
                        mappings[visualType] = new VisualMapping(mappingOption);
                    }, this);
                }, this);
            }
        },

        /**
         * @protected
         */
        completeVisualOption: function () {
            var thisOption = this.option;
            var base = {inRange: thisOption.inRange, outOfRange: thisOption.outOfRange};

            var target = thisOption.target || (thisOption.target = {});
            var controller = thisOption.controller || (thisOption.controller = {});

            zrUtil.merge(target, base);
            zrUtil.merge(controller, base);

            completeSingle.call(this, target);
            completeSingle.call(this, controller);
            completeInactive.call(this, target, 'inRange', 'outOfRange');
            completeInactive.call(this, target, 'outOfRange', 'inRange');
            completeController.call(this, controller);

            function completeSingle(base) {
                // Compatible with ec2 dataRange.color.
                // The mapping order of dataRange.color is: [high value, ..., low value]
                // whereas inRange.color and outOfRange.color is [low value, ..., high value]
                if (zrUtil.isArray(thisOption.color)
                    // If there has been inRange: {symbol: ...}, adding color is a mistake.
                    // So adding color only when no inRange defined.
                    && !base.inRange
                ) {
                    base.inRange = {color: thisOption.color.slice().reverse()};
                }

                // If using shortcut like: {inRange: 'symbol'}, complete default value.
                zrUtil.each(this.stateList, function (state) {
                    var visualType = base[state];

                    if (zrUtil.isString(visualType)) {
                        var defa = VisualMapping.getDefault(visualType, 'active');
                        if (defa) {
                            base[state] = {};
                            base[state][visualType] = defa;
                        }
                        else {
                            // Mark as not specified.
                            delete base[state];
                        }
                    }
                }, this);
            }

            function completeInactive(base, stateExist, stateAbsent) {
                var optExist = base[stateExist];
                var optAbsent = base[stateAbsent];
                if (optExist && !optAbsent) {
                    optAbsent = base[stateAbsent] = {};
                    zrUtil.each(optExist, function (visualData, visualType) {
                        var defa = VisualMapping.getDefault(visualType, 'inactive');
                        if (VisualMapping.isValidType(visualType) && defa) {
                            optAbsent[visualType] = defa;
                        }
                    });
                }
            }

            function completeController(controller) {
                var symbolExists = (controller.inRange || {}).symbol
                    || (controller.outOfRange || {}).symbol;
                var symbolSizeExists = (controller.inRange || {}).symbolSize
                    || (controller.outOfRange || {}).symbolSize;

                zrUtil.each(this.stateList, function (state) {

                    var itemSize = this.itemSize;
                    var visuals = controller[state];

                    // Set inactive color for controller if no other color attr (like colorA) specified.
                    if (!visuals) {
                        visuals = controller[state] = {color: [this.get('inactiveColor')]};
                    }

                    // Consistent symbol and symbolSize if not specified.
                    if (!visuals.symbol) {
                        visuals.symbol = symbolExists && symbolExists.slice() || ['roundRect'];
                    }
                    if (!visuals.symbolSize) {
                        visuals.symbolSize = symbolSizeExists
                            && symbolSizeExists.slice()
                            || [itemSize[0], itemSize[0]];
                    }

                    // Filter square and none.
                    visuals.symbol = zrUtil.map(visuals.symbol, function (symbol) {
                        return (symbol === 'none' || symbol === 'square')
                            ? 'roundRect' : symbol;
                    });

                    // Normalize symbolSize
                    var symbolSize = visuals.symbolSize;
                    if (symbolSize) {
                        symbolSize[0] = linearMap(
                            symbolSize[0], [0, symbolSize[1]], [0, itemSize[0]], true
                        );
                        symbolSize[1] = linearMap(
                            symbolSize[1], [0, symbolSize[1]], [0, itemSize[0]], true
                        );
                    }

                }, this);
            }
        },

        /**
         * @public
         */
        eachTargetSeries: function (callback, context) {
            zrUtil.each(this.option.seriesIndex, function (seriesIndex) {
                callback.call(context, this.ecModel.getSeriesByIndex(seriesIndex, true));
            }, this);
        },

        /**
         * @protected
         */
        resetItemSize: function () {
            this.itemSize = [+this.get('itemWidth'), +this.get('itemHeight')];
        },

        /**
         * @public
         * @abstract
         */
        setSelected: zrUtil.noop,

        /**
         * @public
         * @abstract
         */
        getValueState: zrUtil.noop

    });

});