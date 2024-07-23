import { assert } from 'chai'
import { JSDOM } from 'JSDOM'
import sinon from "sinon"

global.assert = assert
global.JSDOM = JSDOM
global.sinon = sinon
