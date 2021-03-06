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
 * TextScanner
 * api
 */

class QueryParser extends EventDispatcher {
    constructor({getOptionsContext, documentUtil}) {
        super();
        this._getOptionsContext = getOptionsContext;
        this._documentUtil = documentUtil;
        this._text = '';
        this._setTextToken = null;
        this._selectedParser = null;
        this._parseResults = [];
        this._queryParser = document.querySelector('#query-parser-content');
        this._queryParserModeContainer = document.querySelector('#query-parser-mode-container');
        this._queryParserModeSelect = document.querySelector('#query-parser-mode-select');
        this._textScanner = new TextScanner({
            node: this._queryParser,
            getOptionsContext,
            documentUtil,
            searchTerms: true,
            searchKanji: false,
            searchOnClick: true
        });
    }

    get text() {
        return this._text;
    }

    prepare() {
        this._textScanner.prepare();
        this._textScanner.on('searched', this._onSearched.bind(this));
        this._queryParserModeSelect.addEventListener('change', this._onParserChange.bind(this), false);
    }

    setOptions({selectedParser, termSpacing, scanning}) {
        if (selectedParser === null || typeof selectedParser === 'string') {
            this._selectedParser = selectedParser;
        }
        if (typeof termSpacing === 'boolean') {
            this._queryParser.dataset.termSpacing = `${termSpacing}`;
        }
        if (scanning !== null && typeof scanning === 'object') {
            this._textScanner.setOptions(scanning);
        }
        this._textScanner.setEnabled(true);
    }

    async setText(text) {
        this._text = text;
        this._setPreview(text);

        const token = {};
        this._setTextToken = token;
        this._parseResults = await api.textParse(text, this._getOptionsContext());
        if (this._setTextToken !== token) { return; }

        this._refreshSelectedParser();

        this._renderParserSelect();
        this._renderParseResult();
    }

    // Private

    _onSearched({type, definitions, sentence, inputInfo, textSource, optionsContext, error}) {
        if (error !== null) {
            yomichan.logError(error);
            return;
        }
        if (type === null) { return; }

        this.trigger('searched', {
            type,
            definitions,
            sentence,
            inputInfo,
            textSource,
            optionsContext
        });
    }

    _onParserChange(e) {
        const value = e.currentTarget.value;
        this._setSelectedParser(value);
    }

    _refreshSelectedParser() {
        if (this._parseResults.length > 0 && !this._getParseResult()) {
            const value = this._parseResults[0].id;
            this._setSelectedParser(value);
        }
    }

    _setSelectedParser(value) {
        const optionsContext = this._getOptionsContext();
        api.modifySettings([{
            action: 'set',
            path: 'parsing.selectedParser',
            value,
            scope: 'profile',
            optionsContext
        }], 'search');
    }

    _getParseResult() {
        const selectedParser = this._selectedParser;
        return this._parseResults.find((r) => r.id === selectedParser);
    }

    _setPreview(text) {
        const terms = [[{text, reading: ''}]];
        this._queryParser.textContent = '';
        this._queryParser.appendChild(this._createParseResult(terms, true));
    }

    _renderParserSelect() {
        const visible = (this._parseResults.length > 1);
        if (visible) {
            this._updateParserModeSelect(this._queryParserModeSelect, this._parseResults, this._selectedParser);
        }
        this._queryParserModeContainer.hidden = !visible;
    }

    _renderParseResult() {
        const parseResult = this._getParseResult();
        this._queryParser.textContent = '';
        if (!parseResult) { return; }
        this._queryParser.appendChild(this._createParseResult(parseResult.content, false));
    }

    _updateParserModeSelect(select, parseResults, selectedParser) {
        const fragment = document.createDocumentFragment();

        let index = 0;
        let selectedIndex = -1;
        for (const parseResult of parseResults) {
            const option = document.createElement('option');
            option.value = parseResult.id;
            switch (parseResult.source) {
                case 'scanning-parser':
                    option.textContent = 'Scanning parser';
                    break;
                case 'mecab':
                    option.textContent = `MeCab: ${parseResult.dictionary}`;
                    break;
                default:
                    option.textContent = `Unknown source: ${parseResult.source}`;
                    break;
            }
            fragment.appendChild(option);

            if (selectedParser === parseResult.id) {
                selectedIndex = index;
            }
            ++index;
        }

        select.textContent = '';
        select.appendChild(fragment);
        select.selectedIndex = selectedIndex;
    }

    _createParseResult(terms, preview) {
        const type = preview ? 'preview' : 'normal';
        const fragment = document.createDocumentFragment();
        for (const term of terms) {
            const termNode = document.createElement('span');
            termNode.className = 'query-parser-term';
            termNode.dataset.type = type;
            for (const segment of term) {
                if (segment.reading.trim().length === 0) {
                    this._addSegmentText(segment.text, termNode);
                } else {
                    termNode.appendChild(this._createSegment(segment));
                }
            }
            fragment.appendChild(termNode);
        }
        return fragment;
    }

    _createSegment(segment) {
        const segmentNode = document.createElement('ruby');
        segmentNode.className = 'query-parser-segment';

        const textNode = document.createElement('span');
        textNode.className = 'query-parser-segment-text';

        const readingNode = document.createElement('rt');
        readingNode.className = 'query-parser-segment-reading';

        segmentNode.appendChild(textNode);
        segmentNode.appendChild(readingNode);

        this._addSegmentText(segment.text, textNode);
        readingNode.textContent = segment.reading;

        return segmentNode;
    }

    _addSegmentText(text, container) {
        for (const character of text) {
            const node = document.createElement('span');
            node.className = 'query-parser-char';
            node.textContent = character;
            container.appendChild(node);
        }
    }
}
