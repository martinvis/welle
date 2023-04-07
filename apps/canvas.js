class Canvas {
	moveStartX;
	moveStartY;
	moveEndX;
	moveEndY;
	isActive = true;
	isPieceMoving = false;
	selectedPiece = null;
	validMoves = [];
	notification = "Player with " + Colors.LIGHT.name + " pieces to start.";

	constructor(htmlElement, fieldSize) {
		this.htmlElement = htmlElement;
		this.ctx = htmlElement.getContext("2d");
		this.board = new ChessBoard();
		this.fieldSize = fieldSize;
		this.startX = fieldSize;
		this.startY = 9*fieldSize;

		htmlElement.width = 10*fieldSize;
		htmlElement.height = 10*fieldSize; 

		document.onkeydown = function(e) {
			if (e.key == 'v') {
				// do something
			}
		}

		htmlElement.onmousedown = function(e) {
			var field = canvas.getFieldByCoords(e.x, e.y);
			if (field != null) {
				var piece = canvas.board.getPiece(field);
				if (piece != null && piece.color == canvas.board.activeColor) {
					canvas.selectedPiece = piece;
					canvas.validMoves = piece.getValidMoves(canvas.board);
					console.log("Selected piece %s on %s", piece, field);
					console.log("Valid moves: %s", canvas.validMoves);

					canvas.moveStartX = e.x;
					canvas.moveStartY = e.y;
					canvas.moveEndX = canvas.moveStartX;
					canvas.moveEndY = canvas.moveStartY;

					canvas.isPieceMoving = true;
					canvas.drawGame();
				}
			}
		}
		htmlElement.onmouseup = function(e) {
			var newField = canvas.getFieldByCoords(e.x, e.y);
			if (newField != null && canvas.selectedPiece != null) {

				var moves = [];
				for (var move of canvas.selectedPiece.getValidMoves()) {
					if (move.getEndField().equals(newField)) {
						moves.push(move);
					}
				}

				if (moves.length == 1) {
					canvas.movePiece(moves[0]);
				} else if (moves.length > 1) {
					canvas.showMoveChoices(moves);
				}

				canvas.isPieceMoving = false;
				canvas.drawGame();
			}
		}
		htmlElement.onmousemove = function(e) {
			if (canvas.selectedPiece != null) {
				canvas.moveEndX = e.x;
				canvas.moveEndY = e.y;

				canvas.drawGame();
			}
		}

		this.drawGame();
	}

	showMoveChoices(moves) {
		document.getElementById('board').classList.add('disabled');
		document.getElementById('promotion').classList.remove('hidden');

		for (var move of moves) {
			var button = document.createElement('button');
			button.type = 'button';
			button.innerHTML = move.label;
			(function(_move) {
				button.onclick = function() {
					canvas.chooseMove(_move);
				}
			})(move);
			document.getElementById('moves').appendChild(button);
		}
	}
	hideMoveChoices() {
		document.getElementById('board').classList.remove('disabled');
		document.getElementById('promotion').classList.add('hidden');
		document.getElementById('moves').innerHTML = '';
		this.drawGame();	
	}
	chooseMove(move) {
		this.movePiece(move);
		this.hideMoveChoices();
	}
	movePiece(move) {
		this.board.movePiece(move);
		this.selectedPiece = null;
		this.validMoves = [];

		if (this.board.ended) {
			this.isActive = false;
			if (this.board.winner != null) {
				this.notification = "Player with " + this.board.winner + " pieces won.";
			} else {
				this.notification = "Draw, no valid moves.";
			}
		} else {
			this.notification = "Player with " + this.board.activeColor.name + " pieces to move.";
		}
	}

	getFieldByCoords(x, y) {
		var clickX = x - this.htmlElement.offsetLeft;
		var clickY = y - this.htmlElement.offsetTop;
		var column = Math.ceil((clickX - this.startX) / this.fieldSize);
		var row = Math.ceil((this.startY - clickY) / this.fieldSize);

		var field = new BoardField (column, row);
		if (this.isActive && this.board.isFieldValid(field)) {
			return field;
		} else {
			return null;
		}
	}

	drawBackground() {
		this.ctx.fillStyle = "#CCC";
		this.ctx.fillRect(0, 0, 800, 800);
	}
	drawBoard() {
		for (var i=1; i<=8; i++) {
			for (var j=1; j<=8; j++) {
				this.drawField(i, j);
			}
		}
		for (var piece of this.board.pieces) {
			if (!this.isPieceMoving || this.selectedPiece != piece) {
				this.drawPiece(piece);
			}
		}
	}

	drawField(column, row) {
		this.ctx.fillStyle = (column + row) % 2 == 0 ? "#258" : "#FFF";
		this.ctx.fillRect(this.startX + (column-1)*this.fieldSize, this.startY - (row)*this.fieldSize, this.fieldSize, this.fieldSize);			
	}
	drawPiece(piece, dragX = 0, dragY = 0) {
		var image = images.get(piece.color.name + piece.constructor.name);
		this.ctx.drawImage(image, this.startX + (piece.field.column-1)*this.fieldSize + dragX, this.startY - (piece.field.row)*this.fieldSize + dragY, this.fieldSize, this.fieldSize);
	}
	highlightField(field) {
		this.ctx.beginPath();
		this.ctx.lineWidth = "1";
		this.ctx.strokeStyle = "#A00";
		this.ctx.fillStyle = "rgba(100, 0, 0, 0.2)";
		this.ctx.rect(this.startX + (field.column-1)*this.fieldSize, this.startY - (field.row)*this.fieldSize, this.fieldSize, this.fieldSize);
		this.ctx.fill()
		this.ctx.stroke();
	}
	underlineField(field) {
		this.ctx.fillStyle = "rgba(250, 150, 0, 0.4)";
		this.ctx.fillRect(this.startX + (field.column-1)*this.fieldSize, this.startY - (field.row)*this.fieldSize, this.fieldSize, this.fieldSize);
	}

	drawGame() {
		this.drawBackground();
		this.drawBoard();

		var latestMove = this.board.getLatestMove();
		if (latestMove != null) {
			this.underlineField(latestMove.getStartField());
			this.underlineField(latestMove.getEndField());
		}

		if (this.selectedPiece != null) {
			for (var move of this.validMoves) {
				var field = move.getEndField();
				this.highlightField(field);
			}
			if (this.isPieceMoving) {
				this.drawPiece(this.selectedPiece, this.moveEndX - this.moveStartX, this.moveEndY - this.moveStartY);
			}
		}

		this.ctx.font = this.fieldSize * 2/5 + "px arial";
		this.ctx.fillStyle = "rgba(0, 0, 0, 1)";
		this.ctx.fillText(this.notification, this.fieldSize, this.fieldSize * 3/5); 

		this.ctx.restore();
	}

}
