/*
 * Copyright (C) 2019-2020  Yomichan Authors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

/* global
 * DocumentUtil
 * api
 */

class TextScanner extends EventDispatcher {
    constructor({
        node,
        documentUtil,
        getOptionsContext,
        ignoreElements=null,
        ignorePoint=null,
        searchTerms=false,
        searchKanji=false,
        searchOnClick=false,
        searchOnClickOnly=false
    }) {
        super();
        this._node = node;
        this._documentUtil = documentUtil;
        this._getOptionsContext = getOptionsContext;
        this._ignoreElements = ignoreElements;
        this._ignorePoint = ignorePoint;
        this._searchTerms = searchTerms;
        this._searchKanji = searchKanji;
        this._searchOnClick = searchOnClick;
        this._searchOnClickOnly = searchOnClickOnly;

        this._isPrepared = false;
        this._includeSelector = null;
        this._excludeSelector = null;

        this._inputInfoCurrent = null;
        this._scanTimerPromise = null;
        this._textSourceCurrent = null;
        this._textSourceCurrentSelected = false;
        this._pendingLookup = false;

        this._deepContentScan = false;
        this._selectText = false;
        this._delay = 0;
        this._touchInputEnabled = false;
        this._pointerEventsEnabled = false;
        this._scanLength = 1;
        this._sentenceExtent = 1;
        this._layoutAwareScan = false;
        this._preventMiddleMouse = false;
        this._inputs = [];

        this._enabled = false;
        this._enabledValue = false;
        this._eventListeners = new EventListenerCollection();

        this._primaryTouchIdentifier = null;
        this._preventNextContextMenu = false;
        this._preventNextMouseDown = false;
        this._preventNextClick = false;
        this._preventScroll = false;
        this._penPointerPressed = false;
        this._penPointerReleased = false;
        this._pointerIdTypeMap = new Map();

        this._canClearSelection = true;
    }

    get canClearSelection() {
        return this._canClearSelection;
    }

    set canClearSelection(value) {
        this._canClearSelection = value;
    }

    get includeSelector() {
        return this._includeSelector;
    }

    set includeSelector(value) {
        this._includeSelector = value;
    }

    get excludeSelector() {
        return this._excludeSelector;
    }

    set excludeSelector(value) {
        this._excludeSelector = value;
    }

    prepare() {
        this._isPrepared = true;
        this.setEnabled(this._enabled);
    }

    setEnabled(enabled) {
        this._enabled = enabled;

        const value = enabled && this._isPrepared;
        if (this._enabledValue === value) { return; }

        this._eventListeners.removeAllEventListeners();
        this._primaryTouchIdentifier = null;
        this._preventNextContextMenu = false;
        this._preventNextMouseDown = false;
        this._preventNextClick = false;
        this._preventScroll = false;
        this._penPointerPressed = false;
        this._penPointerReleased = false;
        this._pointerIdTypeMap.clear();

        this._enabledValue = value;

        if (value) {
            this._hookEvents();
        } else {
            this.clearSelection(true);
        }
    }

    setOptions({inputs, deepContentScan, selectText, delay, touchInputEnabled, pointerEventsEnabled, scanLength, sentenceExtent, layoutAwareScan, preventMiddleMouse}) {
        if (Array.isArray(inputs)) {
            this._inputs = inputs.map(({
                include,
                exclude,
                types,
                options: {
                    searchTerms,
                    searchKanji,
                    scanOnTouchMove,
                    scanOnPenHover,
                    scanOnPenPress,
                    scanOnPenRelease,
                    preventTouchScrolling
                }
            }) => ({
                include: this._getInputArray(include),
                exclude: this._getInputArray(exclude),
                types: this._getInputTypeSet(types),
                options: {
                    searchTerms,
                    searchKanji,
                    scanOnTouchMove,
                    scanOnPenHover,
                    scanOnPenPress,
                    scanOnPenRelease,
                    preventTouchScrolling
                }
            }));
        }
        if (typeof deepContentScan === 'boolean') {
            this._deepContentScan = deepContentScan;
        }
        if (typeof selectText === 'boolean') {
            this._selectText = selectText;
        }
        if (typeof delay === 'number') {
            this._delay = delay;
        }
        if (typeof touchInputEnabled === 'boolean') {
            this._touchInputEnabled = touchInputEnabled;
        }
        if (typeof pointerEventsEnabled === 'boolean') {
            this._pointerEventsEnabled = pointerEventsEnabled;
        }
        if (typeof scanLength === 'number') {
            this._scanLength = scanLength;
        }
        if (typeof sentenceExtent === 'number') {
            this._sentenceExtent = sentenceExtent;
        }
        if (typeof layoutAwareScan === 'boolean') {
            this._layoutAwareScan = layoutAwareScan;
        }
        if (typeof preventMiddleMouse === 'boolean') {
            this._preventMiddleMouse = preventMiddleMouse;
        }
    }

    getTextSourceContent(textSource, length, layoutAwareScan) {
        const clonedTextSource = textSource.clone();

        clonedTextSource.setEndOffset(length, layoutAwareScan);

        if (this._excludeSelector !== null) {
            this._constrainTextSource(clonedTextSource, this._includeSelector, this._excludeSelector, layoutAwareScan);
        }

        return clonedTextSource.text();
    }

    hasSelection() {
        return (this._textSourceCurrent !== null);
    }

    clearSelection(passive) {
        if (!this._canClearSelection) { return; }
        if (this._textSourceCurrent !== null) {
            if (this._textSourceCurrentSelected) {
                this._textSourceCurrent.deselect();
            }
            this._textSourceCurrent = null;
            this._textSourceCurrentSelected = false;
            this._inputInfoCurrent = null;
        }
        this.trigger('clearSelection', {passive});
    }

    getCurrentTextSource() {
        return this._textSourceCurrent;
    }

    setCurrentTextSource(textSource) {
        this._textSourceCurrent = textSource;
        if (this._selectText) {
            this._textSourceCurrent.select();
            this._textSourceCurrentSelected = true;
        } else {
            this._textSourceCurrentSelected = false;
        }
    }

    async searchLast() {
        if (this._textSourceCurrent !== null && this._inputInfoCurrent !== null) {
            await this._search(this._textSourceCurrent, this._searchTerms, this._searchKanji, this._inputInfoCurrent);
            return true;
        }
        return false;
    }

    async search(textSource) {
        const inputInfo = this._createInputInfo(-1, false, null, 'script', 'script', [], []);
        return await this._search(textSource, this._searchTerms, this._searchKanji, inputInfo);
    }

    // Private

    async _getOptionsContextForInput(inputInfo) {
        const optionsContext = clone(await this._getOptionsContext());
        const {modifiers, modifierKeys} = inputInfo;
        optionsContext.modifiers = [...modifiers];
        optionsContext.modifierKeys = [...modifierKeys];
        return optionsContext;
    }

    async _search(textSource, searchTerms, searchKanji, inputInfo) {
        let definitions = null;
        let sentence = null;
        let type = null;
        let error = null;
        let searched = false;
        let optionsContext = null;

        try {
            if (this._textSourceCurrent !== null && this._textSourceCurrent.hasSameStart(textSource)) {
                return;
            }

            optionsContext = await this._getOptionsContextForInput(inputInfo);
            searched = true;

            const result = await this._findDefinitions(textSource, searchTerms, searchKanji, optionsContext);
            if (result !== null) {
                ({definitions, sentence, type} = result);
                this._inputInfoCurrent = inputInfo;
                this.setCurrentTextSource(textSource);
            }
        } catch (e) {
            error = e;
        }

        if (!searched) { return; }

        this.trigger('searched', {
            textScanner: this,
            type,
            definitions,
            sentence,
            inputInfo,
            textSource,
            optionsContext,
            error
        });
    }

    _onMouseOver(e) {
        if (this._ignoreElements !== null && this._ignoreElements().includes(e.target)) {
            this._scanTimerClear();
        }
    }

    _onMouseMove(e) {
        this._scanTimerClear();

        const inputInfo = this._getMatchingInputGroupFromEvent('mouse', 'mouseMove', e);
        if (inputInfo === null) { return; }

        this._searchAtFromMouseMove(e.clientX, e.clientY, inputInfo);
    }

    _onMouseDown(e) {
        if (this._preventNextMouseDown) {
            this._preventNextMouseDown = false;
            this._preventNextClick = true;
            e.preventDefault();
            e.stopPropagation();
            return false;
        }

        switch (e.button) {
            case 0: // Primary
                this._scanTimerClear();
                this.clearSelection(false);
                break;
            case 1: // Middle
                if (this._preventMiddleMouse) {
                    e.preventDefault();
                    e.stopPropagation();
                    return false;
                }
                break;
        }
    }

    _onMouseOut() {
        this._scanTimerClear();
    }

    _onClick(e) {
        if (this._searchOnClick) {
            const modifiers = DocumentUtil.getActiveModifiersAndButtons(e);
            const modifierKeys = DocumentUtil.getActiveModifiers(e);
            const inputInfo = this._createInputInfo(-1, false, null, 'mouse', 'click', modifiers, modifierKeys);
            this._searchAt(e.clientX, e.clientY, inputInfo);
        }

        if (this._preventNextClick) {
            this._preventNextClick = false;
            e.preventDefault();
            e.stopPropagation();
            return false;
        }
    }

    _onAuxClick() {
        this._preventNextContextMenu = false;
    }

    _onContextMenu(e) {
        if (this._preventNextContextMenu) {
            this._preventNextContextMenu = false;
            e.preventDefault();
            e.stopPropagation();
            return false;
        }
    }

    _onTouchStart(e) {
        if (this._primaryTouchIdentifier !== null || e.changedTouches.length === 0) {
            return;
        }

        const {clientX, clientY, identifier} = e.changedTouches[0];
        this._onPrimaryTouchStart(e, clientX, clientY, identifier);
    }

    _onPrimaryTouchStart(e, x, y, identifier) {
        this._preventScroll = false;
        this._preventNextContextMenu = false;
        this._preventNextMouseDown = false;
        this._preventNextClick = false;

        if (DocumentUtil.isPointInSelection(x, y, window.getSelection())) {
            return;
        }

        this._primaryTouchIdentifier = identifier;

        this._searchAtFromTouchStart(e, x, y);
    }

    _onTouchEnd(e) {
        if (
            this._primaryTouchIdentifier === null ||
            this._getTouch(e.changedTouches, this._primaryTouchIdentifier) === null
        ) {
            return;
        }

        this._onPrimaryTouchEnd();
    }

    _onPrimaryTouchEnd() {
        this._primaryTouchIdentifier = null;
        this._preventScroll = false;
        this._preventNextClick = false;
        // Don't revert context menu and mouse down prevention, since these events can occur after the touch has ended.
        // I.e. this._preventNextContextMenu and this._preventNextMouseDown should not be assigned to false.
    }

    _onTouchCancel(e) {
        this._onTouchEnd(e);
    }

    _onTouchMove(e) {
        if (!this._preventScroll || !e.cancelable || this._primaryTouchIdentifier === null) {
            return;
        }

        const primaryTouch = this._getTouch(e.changedTouches, this._primaryTouchIdentifier);
        if (primaryTouch === null) {
            return;
        }

        const inputInfo = this._getMatchingInputGroupFromEvent('touch', 'touchMove', e);
        if (inputInfo === null) { return; }

        if (inputInfo.input.options.scanOnTouchMove) {
            this._searchAt(primaryTouch.clientX, primaryTouch.clientY, inputInfo);
        }

        e.preventDefault(); // Disable scroll
    }

    _onPointerOver(e) {
        const {pointerType, pointerId, isPrimary} = e;
        if (pointerType === 'pen') {
            this._pointerIdTypeMap.set(pointerId, pointerType);
        }

        if (!isPrimary) { return; }
        switch (pointerType) {
            case 'mouse': return this._onMousePointerOver(e);
            case 'touch': return this._onTouchPointerOver(e);
            case 'pen': return this._onPenPointerOver(e);
        }
    }

    _onPointerDown(e) {
        if (!e.isPrimary) { return; }
        switch (this._getPointerEventType(e)) {
            case 'mouse': return this._onMousePointerDown(e);
            case 'touch': return this._onTouchPointerDown(e);
            case 'pen': return this._onPenPointerDown(e);
        }
    }

    _onPointerMove(e) {
        if (!e.isPrimary) { return; }
        switch (this._getPointerEventType(e)) {
            case 'mouse': return this._onMousePointerMove(e);
            case 'touch': return this._onTouchPointerMove(e);
            case 'pen': return this._onPenPointerMove(e);
        }
    }

    _onPointerUp(e) {
        if (!e.isPrimary) { return; }
        switch (this._getPointerEventType(e)) {
            case 'mouse': return this._onMousePointerUp(e);
            case 'touch': return this._onTouchPointerUp(e);
            case 'pen': return this._onPenPointerUp(e);
        }
    }

    _onPointerCancel(e) {
        this._pointerIdTypeMap.delete(e.pointerId);
        if (!e.isPrimary) { return; }
        switch (e.pointerType) {
            case 'mouse': return this._onMousePointerCancel(e);
            case 'touch': return this._onTouchPointerCancel(e);
            case 'pen': return this._onPenPointerCancel(e);
        }
    }

    _onPointerOut(e) {
        this._pointerIdTypeMap.delete(e.pointerId);
        if (!e.isPrimary) { return; }
        switch (e.pointerType) {
            case 'mouse': return this._onMousePointerOut(e);
            case 'touch': return this._onTouchPointerOut(e);
            case 'pen': return this._onPenPointerOut(e);
        }
    }

    _onMousePointerOver(e) {
        return this._onMouseOver(e);
    }

    _onMousePointerDown(e) {
        return this._onMouseDown(e);
    }

    _onMousePointerMove(e) {
        return this._onMouseMove(e);
    }

    _onMousePointerUp() {
        // NOP
    }

    _onMousePointerCancel(e) {
        return this._onMouseOut(e);
    }

    _onMousePointerOut(e) {
        return this._onMouseOut(e);
    }

    _onTouchPointerOver() {
        // NOP
    }

    _onTouchPointerDown(e) {
        const {clientX, clientY, pointerId} = e;
        return this._onPrimaryTouchStart(e, clientX, clientY, pointerId);
    }

    _onTouchPointerMove(e) {
        if (!this._preventScroll || !e.cancelable) {
            return;
        }

        const inputInfo = this._getMatchingInputGroupFromEvent('touch', 'touchMove', e);
        if (inputInfo === null || !inputInfo.input.options.scanOnTouchMove) { return; }

        this._searchAt(e.clientX, e.clientY, inputInfo);
    }

    _onTouchPointerUp() {
        return this._onPrimaryTouchEnd();
    }

    _onTouchPointerCancel() {
        return this._onPrimaryTouchEnd();
    }

    _onTouchPointerOut() {
        // NOP
    }

    _onTouchMovePreventScroll(e) {
        if (!this._preventScroll) { return; }

        if (e.cancelable) {
            e.preventDefault();
        } else {
            this._preventScroll = false;
        }
    }

    _onPenPointerOver(e) {
        this._penPointerPressed = false;
        this._penPointerReleased = false;
        this._searchAtFromPen(e, e.clientX, e.clientY, 'pointerOver', false);
    }

    _onPenPointerDown(e) {
        this._penPointerPressed = true;
        this._searchAtFromPen(e, e.clientX, e.clientY, 'pointerDown', true);
    }

    _onPenPointerMove(e) {
        if (this._penPointerPressed && (!this._preventScroll || !e.cancelable)) { return; }
        this._searchAtFromPen(e, e.clientX, e.clientY, 'pointerMove', true);
    }

    _onPenPointerUp() {
        this._penPointerPressed = false;
        this._penPointerReleased = true;
        this._preventScroll = false;
    }

    _onPenPointerCancel(e) {
        this._onPenPointerOut(e);
    }

    _onPenPointerOut() {
        this._penPointerPressed = false;
        this._penPointerReleased = false;
        this._preventScroll = false;
        this._preventNextContextMenu = false;
        this._preventNextMouseDown = false;
        this._preventNextClick = false;
    }

    async _scanTimerWait() {
        const delay = this._delay;
        const promise = promiseTimeout(delay, true);
        this._scanTimerPromise = promise;
        try {
            return await promise;
        } finally {
            if (this._scanTimerPromise === promise) {
                this._scanTimerPromise = null;
            }
        }
    }

    _scanTimerClear() {
        if (this._scanTimerPromise !== null) {
            this._scanTimerPromise.resolve(false);
            this._scanTimerPromise = null;
        }
    }

    _arePointerEventsSupported() {
        return (this._pointerEventsEnabled && typeof PointerEvent !== 'undefined');
    }

    _hookEvents() {
        let eventListenerInfos;
        if (this._searchOnClickOnly) {
            eventListenerInfos = this._getMouseClickOnlyEventListeners();
        } else if (this._arePointerEventsSupported()) {
            eventListenerInfos = this._getPointerEventListeners();
        } else {
            eventListenerInfos = this._getMouseEventListeners();
            if (this._touchInputEnabled) {
                eventListenerInfos.push(...this._getTouchEventListeners());
            }
        }

        for (const [node, type, listener, options] of eventListenerInfos) {
            this._eventListeners.addEventListener(node, type, listener, options);
        }
    }

    _getPointerEventListeners() {
        return [
            [this._node, 'pointerover', this._onPointerOver.bind(this)],
            [this._node, 'pointerdown', this._onPointerDown.bind(this)],
            [this._node, 'pointermove', this._onPointerMove.bind(this)],
            [this._node, 'pointerup', this._onPointerUp.bind(this)],
            [this._node, 'pointercancel', this._onPointerCancel.bind(this)],
            [this._node, 'pointerout', this._onPointerOut.bind(this)],
            [this._node, 'touchmove', this._onTouchMovePreventScroll.bind(this), {passive: false}],
            [this._node, 'mousedown', this._onMouseDown.bind(this)],
            [this._node, 'click', this._onClick.bind(this)],
            [this._node, 'auxclick', this._onAuxClick.bind(this)]
        ];
    }

    _getMouseEventListeners() {
        return [
            [this._node, 'mousedown', this._onMouseDown.bind(this)],
            [this._node, 'mousemove', this._onMouseMove.bind(this)],
            [this._node, 'mouseover', this._onMouseOver.bind(this)],
            [this._node, 'mouseout', this._onMouseOut.bind(this)],
            [this._node, 'click', this._onClick.bind(this)]
        ];
    }

    _getMouseClickOnlyEventListeners() {
        return [
            [this._node, 'click', this._onClick.bind(this)]
        ];
    }
    _getTouchEventListeners() {
        return [
            [this._node, 'auxclick', this._onAuxClick.bind(this)],
            [this._node, 'touchstart', this._onTouchStart.bind(this)],
            [this._node, 'touchend', this._onTouchEnd.bind(this)],
            [this._node, 'touchcancel', this._onTouchCancel.bind(this)],
            [this._node, 'touchmove', this._onTouchMove.bind(this), {passive: false}],
            [this._node, 'contextmenu', this._onContextMenu.bind(this)]
        ];
    }

    _getTouch(touchList, identifier) {
        for (const touch of touchList) {
            if (touch.identifier === identifier) {
                return touch;
            }
        }
        return null;
    }

    async _findDefinitions(textSource, searchTerms, searchKanji, optionsContext) {
        if (textSource === null) {
            return null;
        }
        if (searchTerms) {
            const results = await this._findTerms(textSource, optionsContext);
            if (results !== null) { return results; }
        }
        if (searchKanji) {
            const results = await this._findKanji(textSource, optionsContext);
            if (results !== null) { return results; }
        }
        return null;
    }

    async _findTerms(textSource, optionsContext) {
        const scanLength = this._scanLength;
        const sentenceExtent = this._sentenceExtent;
        const layoutAwareScan = this._layoutAwareScan;
        const searchText = this.getTextSourceContent(textSource, scanLength, layoutAwareScan);
        if (searchText.length === 0) { return null; }

        const {definitions, length} = await api.termsFind(searchText, {}, optionsContext);
        if (definitions.length === 0) { return null; }

        textSource.setEndOffset(length, layoutAwareScan);
        const sentence = this._documentUtil.extractSentence(textSource, sentenceExtent, layoutAwareScan);

        return {definitions, sentence, type: 'terms'};
    }

    async _findKanji(textSource, optionsContext) {
        const sentenceExtent = this._sentenceExtent;
        const layoutAwareScan = this._layoutAwareScan;
        const searchText = this.getTextSourceContent(textSource, 1, layoutAwareScan);
        if (searchText.length === 0) { return null; }

        const definitions = await api.kanjiFind(searchText, optionsContext);
        if (definitions.length === 0) { return null; }

        textSource.setEndOffset(1, layoutAwareScan);
        const sentence = this._documentUtil.extractSentence(textSource, sentenceExtent, layoutAwareScan);

        return {definitions, sentence, type: 'kanji'};
    }

    async _searchAt(x, y, inputInfo) {
        if (this._pendingLookup) { return; }

        try {
            const sourceInput = inputInfo.input;
            let searchTerms = this._searchTerms;
            let searchKanji = this._searchKanji;
            if (sourceInput !== null) {
                if (searchTerms && !sourceInput.options.searchTerms) { searchTerms = false; }
                if (searchKanji && !sourceInput.options.searchKanji) { searchKanji = false; }
            }

            this._pendingLookup = true;
            this._scanTimerClear();

            if (typeof this._ignorePoint === 'function' && await this._ignorePoint(x, y)) {
                return;
            }

            const textSource = this._documentUtil.getRangeFromPoint(x, y, this._deepContentScan);
            try {
                await this._search(textSource, searchTerms, searchKanji, inputInfo);
            } finally {
                if (textSource !== null) {
                    textSource.cleanup();
                }
            }
        } catch (e) {
            yomichan.logError(e);
        } finally {
            this._pendingLookup = false;
        }
    }

    async _searchAtFromMouseMove(x, y, inputInfo) {
        if (this._pendingLookup) { return; }

        if (inputInfo.empty) {
            if (!await this._scanTimerWait()) {
                // Aborted
                return;
            }
        }

        await this._searchAt(x, y, inputInfo);
    }

    async _searchAtFromTouchStart(e, x, y) {
        if (this._pendingLookup) { return; }

        const inputInfo = this._getMatchingInputGroupFromEvent('touch', 'touchStart', e);
        if (inputInfo === null) { return; }

        const textSourceCurrentPrevious = this._textSourceCurrent !== null ? this._textSourceCurrent.clone() : null;
        const preventScroll = inputInfo.input.options.preventTouchScrolling;

        await this._searchAt(x, y, inputInfo);

        if (
            this._textSourceCurrent !== null &&
            !this._textSourceCurrent.hasSameStart(textSourceCurrentPrevious)
        ) {
            this._preventScroll = preventScroll;
            this._preventNextContextMenu = true;
            this._preventNextMouseDown = true;
        }
    }

    async _searchAtFromPen(e, x, y, cause, prevent) {
        if (this._pendingLookup) { return; }

        const inputInfo = this._getMatchingInputGroupFromEvent('pen', cause, e);
        if (inputInfo === null) { return; }

        const {input: {options}} = inputInfo;
        if (
            (!options.scanOnPenRelease && this._penPointerReleased) ||
            !(this._penPointerPressed ? options.scanOnPenPress : options.scanOnPenHover)
        ) {
            return;
        }

        const preventScroll = inputInfo.input.options.preventTouchScrolling;

        await this._searchAt(x, y, inputInfo);

        if (
            prevent &&
            this._textSourceCurrent !== null
        ) {
            this._preventScroll = preventScroll;
            this._preventNextContextMenu = true;
            this._preventNextMouseDown = true;
            this._preventNextClick = true;
        }
    }

    _getMatchingInputGroupFromEvent(type, cause, event) {
        const modifiers = DocumentUtil.getActiveModifiersAndButtons(event);
        const modifierKeys = DocumentUtil.getActiveModifiers(event);
        return this._getMatchingInputGroup(type, cause, modifiers, modifierKeys);
    }

    _getMatchingInputGroup(type, cause, modifiers, modifierKeys) {
        let fallback = null;
        const modifiersSet = new Set(modifiers);
        for (let i = 0, ii = this._inputs.length; i < ii; ++i) {
            const input = this._inputs[i];
            const {include, exclude, types} = input;
            if (!types.has(type)) { continue; }
            if (this._setHasAll(modifiersSet, include) && (exclude.length === 0 || !this._setHasAll(modifiersSet, exclude))) {
                if (include.length > 0) {
                    return this._createInputInfo(i, false, input, type, cause, modifiers, modifierKeys);
                } else if (fallback === null) {
                    fallback = this._createInputInfo(i, true, input, type, cause, modifiers, modifierKeys);
                }
            }
        }
        return fallback;
    }

    _createInputInfo(index, empty, input, type, cause, modifiers, modifierKeys) {
        return {index, empty, input, type, cause, modifiers, modifierKeys};
    }

    _setHasAll(set, values) {
        for (const value of values) {
            if (!set.has(value)) {
                return false;
            }
        }
        return true;
    }

    _getInputArray(value) {
        return (
            typeof value === 'string' ?
            value.split(/[,;\s]+/).map((v) => v.trim().toLowerCase()).filter((v) => v.length > 0) :
            []
        );
    }

    _getInputTypeSet({mouse, touch, pen}) {
        const set = new Set();
        if (mouse) { set.add('mouse'); }
        if (touch) { set.add('touch'); }
        if (pen) { set.add('pen'); }
        return set;
    }

    _getPointerEventType(e) {
        // Workaround for Firefox bug not detecting certain 'touch' events as 'pen' events.
        const cachedPointerType = this._pointerIdTypeMap.get(e.pointerId);
        return (typeof cachedPointerType !== 'undefined' ? cachedPointerType : e.pointerType);
    }

    _constrainTextSource(textSource, includeSelector, excludeSelector, layoutAwareScan) {
        let length = textSource.text().length;
        while (length > 0) {
            const nodes = textSource.getNodesInRange();
            if (
                (includeSelector !== null && !DocumentUtil.everyNodeMatchesSelector(nodes, includeSelector)) ||
                (excludeSelector !== null && DocumentUtil.anyNodeMatchesSelector(nodes, excludeSelector))
            ) {
                --length;
                textSource.setEndOffset(length, layoutAwareScan);
            } else {
                break;
            }
        }
    }
}
